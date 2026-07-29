import { IPC, type RecordingFormat } from "../shared/types.js";
import {
  analyzePcmFrame,
  SpeechEndpointDetector,
  diagnoseAudioStats,
  type AudioRecordingStats,
} from "../shared/audio-utils.js";
import { isAutoEndpointEnabled } from "../services/hold-mode-protections.js";

let mediaStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;
let compressorNode: DynamicsCompressorNode | null = null;
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let meterInterval: number | null = null;
let currentGainValue = 1.0;
let recordingStartTime = 0;
let recordingGeneration = 0;
let postRollTimer: ReturnType<typeof setTimeout> | null = null;
let stopRequestedDuringStartup = false;

let endpointDetector = new SpeechEndpointDetector({
  speechThresholdRms: 0.005,
  silenceThresholdRms: 0.003,
  confirmSilenceMs: 500,
  minSpeechDurationMs: 150,
  frameIntervalMs: 50,
});

let autoEndpointEnabled = true;
let transcriptionDelaySec = 0.5;

let sessionMaxRms = 0;
let sessionPeakAmplitude = 0;
let sessionTotalFrames = 0;
let sessionSpeechFrames = 0;
let sessionClippingFrames = 0;
let autoEndpointTriggered = false;
let finalizedRecordingGeneration = -1;

let sessionMaxAbs = 0;
let sessionClippedSamples = 0;
let sessionTotalSamples = 0;
let sessionTrackEnded = false;

let isStartingUp = false;

let recordingSequenceId = 0;

function sendRecordingError(error: string): void {
  window.piVoice?.sendRecordingError(error, recordingSequenceId);
}

function sendRecordingErrorOnce(generation: number, error: string): void {
  if (generation !== recordingGeneration || finalizedRecordingGeneration === generation) return;
  finalizedRecordingGeneration = generation;
  if (postRollTimer) {
    clearTimeout(postRollTimer);
    postRollTimer = null;
  }
  audioChunks = [];
  sendRecordingError(error);
}

function cleanupPartialPipeline() {
  try {
    gainNode?.disconnect();
    analyserNode?.disconnect();
    compressorNode?.disconnect();
  } catch {}
  gainNode = null;
  analyserNode = null;
  compressorNode = null;
  if (audioCtx) {
    try {
      if (audioCtx.state !== "closed") {
        void audioCtx.close();
      }
    } catch {}
    audioCtx = null;
  }
}

async function setupAudioPipeline(inputGain: number = 1.0): Promise<boolean> {
  try {
    currentGainValue = inputGain;
    
    const config = await window.piVoice?.getConfig();
    const targetDeviceId = config?.audioDeviceId;

    const baseAudioConstraints: MediaTrackConstraints = {
      sampleRate: 16000,
      channelCount: 1,
      autoGainControl: false,
      echoCancellation: true,
      noiseSuppression: true,
    };

    if (targetDeviceId && targetDeviceId !== "default") {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { ...baseAudioConstraints, deviceId: { exact: targetDeviceId } },
        });
      } catch (err: any) {
        console.warn(`Target audio device '${targetDeviceId}' unavailable (${err?.message}), falling back to system default.`);
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: baseAudioConstraints,
        });
      }
    } else {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: baseAudioConstraints,
      });
    }

    if (mediaStream) {
      mediaStream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          sessionTrackEnded = true;
          mediaStream = null;
          if (mediaRecorder && mediaRecorder.state !== "inactive") {
            sendRecordingError("Microphone disconnected");
          }
        };
      });
    }
    if (!mediaStream || mediaStream.getAudioTracks().length === 0) {
      cleanupPartialPipeline();
      sendRecordingError("Microphone input unavailable");
      return false;
    }
    audioCtx = new AudioContext({ sampleRate: 16000 });
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(mediaStream);
    
    // 1. GainNode
    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(inputGain, audioCtx.currentTime);

    // 2. AnalyserNode for ~20 Hz RMS intensity metering (post-gain, pre-compressor)
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;

    // 3. DynamicsCompressorNode
    compressorNode = audioCtx.createDynamicsCompressor();

    // 4. Destination for MediaRecorder
    const destination = audioCtx.createMediaStreamDestination();

    // Wire DSP Graph: Stream -> GainNode -> AnalyserNode -> Compressor -> Destination
    source.connect(gainNode);
    gainNode.connect(analyserNode);
    gainNode.connect(compressorNode);
    compressorNode.connect(destination);

    // Setup MediaRecorder using 24kbps Opus speech-compressed destination stream
    mediaRecorder = new MediaRecorder(destination.stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 24000,
    });

    startMetering();
    return true;
  } catch (err: any) {
    cleanupPartialPipeline();
    sendRecordingError(`Microphone access error: ${err.message}`);
    return false;
  }
}

if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === "function") {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (mediaStream) {
      const tracks = mediaStream.getAudioTracks();
      if (tracks.length === 0 || tracks.some((t) => t.readyState === "ended")) {
        mediaStream = null;
      }
    }
  });
}

function startMetering() {
  if (meterInterval) clearInterval(meterInterval);
  
  const buffer = new Float32Array(128);
  let smoothedLevel = 0;

  // Metering at ~20 Hz (50ms interval) with fast attack and slower decay
  meterInterval = window.setInterval(() => {
    if (!analyserNode) return;
    analyserNode.getFloatTimeDomainData(buffer);

    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      const val = buffer[i] ?? 0;
      const qualityVal = currentGainValue > 0 ? val / currentGainValue : val;
      const absVal = Math.abs(qualityVal);
      if (mediaRecorder && mediaRecorder.state === "recording") {
        if (absVal > sessionMaxAbs) sessionMaxAbs = absVal;
        if (absVal >= 0.99) sessionClippedSamples++;
        sessionTotalSamples++;
      }
      sumSquares += qualityVal * qualityVal;
    }
    const gain = Math.max(currentGainValue, 0.0001);
    const metrics = analyzePcmFrame(buffer, 0.005 * gain, 0.003 * gain, 0.99 * gain);
    const normalizedRms = metrics.rms / gain;
    const normalizedPeak = metrics.peak / gain;
    sessionTotalFrames++;
    sessionMaxRms = Math.max(sessionMaxRms, normalizedRms);
    sessionPeakAmplitude = Math.max(sessionPeakAmplitude, normalizedPeak);
    if (metrics.isSpeech) sessionSpeechFrames++;
    if (metrics.isClipped) sessionClippingFrames++;

    if (mediaRecorder && mediaRecorder.state === "recording") {
      const elapsedMs = recordingStartTime > 0 ? Date.now() - recordingStartTime : 0;
      const isWarmingUp = elapsedMs < 200;
      if (!isWarmingUp) {
        const endpointStatus = endpointDetector.processFrame(normalizedRms);
        if (
          endpointStatus.isEndpointed &&
          !autoEndpointTriggered &&
          autoEndpointEnabled &&
          transcriptionDelaySec > 0
        ) {
          autoEndpointTriggered = true;
          triggerAutoStop();
        }
      }
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    if (mediaRecorder && mediaRecorder.state === "recording") {
      if (rms > sessionMaxRms) sessionMaxRms = rms;
    }
    
    // Smooth logarithmic dB scale normalized to [0, 100%]
    const rmsDb = Math.max(-60, Math.min(0, 20 * Math.log10(metrics.rms || 0.0001)));
    const targetLevel = Math.max(0, Math.min(100, Math.round(((rmsDb + 60) / 60) * 100)));

    // Fast attack (0.8), slower decay (0.2)
    if (targetLevel > smoothedLevel) {
      smoothedLevel = smoothedLevel + 0.8 * (targetLevel - smoothedLevel);
    } else {
      smoothedLevel = smoothedLevel + 0.2 * (targetLevel - smoothedLevel);
    }

    // Extract 16 frequency bands for visualizer spectrum
    const barCount = 16;
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(freqData);
    const step = Math.floor(freqData.length / barCount);
    const spectrum: number[] = [];
    for (let i = 0; i < barCount; i++) {
      spectrum.push(freqData[i * step] || 0);
    }

    window.piVoice?.sendAudioLevelUpdate({ level: Math.round(smoothedLevel), spectrum });
  }, 50);
}

function stopMetering() {
  if (meterInterval) {
    clearInterval(meterInterval);
    meterInterval = null;
  }
}

function triggerAutoStop() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  const generation = recordingGeneration;
  if (postRollTimer) clearTimeout(postRollTimer);
  postRollTimer = setTimeout(() => {
    if (generation !== recordingGeneration) return;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }, 250);
}

async function finalizeRecording(generation: number) {
  if (generation !== recordingGeneration || finalizedRecordingGeneration === generation) return;
  finalizedRecordingGeneration = generation;
  if (postRollTimer) {
    clearTimeout(postRollTimer);
    postRollTimer = null;
  }

  if (sessionTrackEnded || !mediaStream || !mediaStream.active || mediaStream.getAudioTracks().every((t) => t.readyState === "ended")) {
    sendRecordingError("Microphone disconnected");
    audioChunks = [];
    return;
  }

  const clipRatio = sessionTotalSamples > 0 ? sessionClippedSamples / sessionTotalSamples : 0;
  if (sessionMaxAbs >= 0.99 && (clipRatio > 0.05 || sessionClippedSamples > 50)) {
    sendRecordingError("Microphone input clipped");
    audioChunks = [];
    return;
  }

  if (sessionMaxAbs < 0.002 && sessionMaxRms < 0.001) {
    sendRecordingError("Microphone input extremely quiet");
    audioChunks = [];
    return;
  }

  const durationMs = Date.now() - recordingStartTime;
  const stats: AudioRecordingStats = {
    durationMs,
    maxRms: sessionMaxRms,
    peakAmplitude: sessionPeakAmplitude,
    speechFrames: sessionSpeechFrames,
    totalFrames: sessionTotalFrames,
    clippingFrames: sessionClippingFrames,
    hasSpeech: endpointDetector.getStatus().hasDetectedSpeech,
  };

  const diag = diagnoseAudioStats(stats);
  if (diag.status === "clipped") {
    sendRecordingError("Microphone input clipped or distorted");
    audioChunks = [];
    return;
  }
  if (diag.status === "near_silence") {
    sendRecordingError("No speech detected (silent audio)");
    audioChunks = [];
    return;
  }
  if (diag.status === "too_short") {
    sendRecordingError("Recording too short");
    audioChunks = [];
    return;
  }

  const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
  const arrayBuffer = await audioBlob.arrayBuffer();
  if (generation !== recordingGeneration) return;
  window.piVoice?.sendRecordingData(arrayBuffer);
  audioChunks = [];
}

(window as any).getAnalyserNode = () => analyserNode;

window.piVoice?.onGainUpdate((newGain: number) => {
  currentGainValue = newGain;
  if (gainNode && audioCtx) {
    gainNode.gain.setValueAtTime(newGain, audioCtx.currentTime);
  }
});

window.piVoice?.onStartRecording(async (format: RecordingFormat, inputGain: number, sequenceId: number) => {
  const generation = ++recordingGeneration;
  recordingSequenceId = sequenceId;
  stopRequestedDuringStartup = false;
  isStartingUp = true;
  finalizedRecordingGeneration = -1;
  audioChunks = [];
  currentGainValue = inputGain;

  try {
    const config = await window.piVoice?.getConfig();
    if (generation !== recordingGeneration) {
      isStartingUp = false;
      return;
    }
    const dictationMode = config?.dictationMode ?? "hold";
    autoEndpointEnabled = isAutoEndpointEnabled(dictationMode, config?.autoEndpointEnabled ?? true);
    transcriptionDelaySec = config?.transcriptionDelaySec ?? 0.5;

    const confirmSilenceMs = Math.round(transcriptionDelaySec * 1000);
    endpointDetector = new SpeechEndpointDetector({
      speechThresholdRms: 0.005,
      silenceThresholdRms: 0.003,
      confirmSilenceMs: confirmSilenceMs > 0 ? confirmSilenceMs : 500,
      minSpeechDurationMs: 150,
      frameIntervalMs: 50,
    });
    endpointDetector.reset();

    sessionMaxRms = 0;
    sessionPeakAmplitude = 0;
    sessionTotalFrames = 0;
    sessionSpeechFrames = 0;
    sessionClippingFrames = 0;
    autoEndpointTriggered = false;
    if (postRollTimer) {
      clearTimeout(postRollTimer);
      postRollTimer = null;
    }

    sessionMaxAbs = 0;
    sessionClippedSamples = 0;
    sessionTotalSamples = 0;
    sessionTrackEnded = false;

    const isStreamValid = mediaStream && mediaStream.active && mediaStream.getAudioTracks().some((t) => t.readyState === "live");

    if (!isStreamValid) {
      mediaStream = null;
    }
    if (!mediaStream || mediaStream.getAudioTracks().some((t) => t.readyState === "ended")) {
      const ok = await setupAudioPipeline(inputGain);
      if (!ok || generation !== recordingGeneration) {
        isStartingUp = false;
        if (generation === recordingGeneration && finalizedRecordingGeneration !== generation) {
          sendRecordingErrorOnce(generation, "Microphone setup failed");
        }
        return;
      }
    } else if (gainNode && audioCtx) {
      gainNode.gain.setValueAtTime(inputGain, audioCtx.currentTime);
    }

    if (audioCtx?.state === "suspended") {
      await audioCtx.resume();
    }

    if (generation !== recordingGeneration) {
      isStartingUp = false;
      return;
    }

    if (mediaRecorder && mediaRecorder.state === "inactive") {
      mediaRecorder.ondataavailable = (event) => {
        if (generation === recordingGeneration && event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      mediaRecorder.onstop = () => { void finalizeRecording(generation); };
      mediaRecorder.start(100);
      recordingStartTime = Date.now();
      isStartingUp = false;
      if (stopRequestedDuringStartup && generation === recordingGeneration) {
        stopRequestedDuringStartup = false;
        stopRecording(true);
      }
    } else {
      isStartingUp = false;
      sendRecordingErrorOnce(generation, "MediaRecorder not ready");
    }
  } catch (err: any) {
    isStartingUp = false;
    stopRequestedDuringStartup = false;
    sendRecordingErrorOnce(generation, `MediaRecorder start failed: ${err?.message || err}`);
  }
});

window.piVoice?.onCancelRecording(() => {
  recordingGeneration++;
  stopRequestedDuringStartup = false;
  isStartingUp = false;
  if (postRollTimer) {
    clearTimeout(postRollTimer);
    postRollTimer = null;
  }
  endpointDetector.reset();
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  } catch {}
  audioChunks = [];
});

function stopRecording(ensureMinimumDuration = false) {
  try {
    const generation = recordingGeneration;
    if (finalizedRecordingGeneration === generation) return;

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      if (isStartingUp) {
        stopRequestedDuringStartup = true;
        return;
      }
      sendRecordingErrorOnce(generation, "Recorder inactive");
      return;
    }

    const doStop = () => {
      if (postRollTimer) clearTimeout(postRollTimer);
      postRollTimer = setTimeout(() => {
        postRollTimer = null;
        if (generation !== recordingGeneration || finalizedRecordingGeneration === generation) return;
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          try {
            mediaRecorder.stop();
          } catch (err: any) {
            sendRecordingErrorOnce(generation, `MediaRecorder stop failed: ${err.message}`);
          }
        } else {
          void finalizeRecording(generation);
        }
      }, 300);
    };

    const elapsed = Date.now() - recordingStartTime;
    const minimumDuration = ensureMinimumDuration ? 800 : 300;
    if (elapsed < minimumDuration) {
      if (postRollTimer) clearTimeout(postRollTimer);
      postRollTimer = setTimeout(() => {
        postRollTimer = null;
        if (generation === recordingGeneration && finalizedRecordingGeneration !== generation) {
          doStop();
        }
      }, minimumDuration - elapsed);
    } else {
      doStop();
    }
  } catch (err: any) {
    sendRecordingErrorOnce(recordingGeneration, `MediaRecorder stop failed: ${err.message}`);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (postRollTimer) clearTimeout(postRollTimer);
    stopMetering();
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    } catch {}
    try {
      if (mediaStream) {
        mediaStream.getAudioTracks().forEach((t) => t.stop());
      }
    } catch {}
    cleanupPartialPipeline();
  });
}

window.piVoice?.onStopRecording(stopRecording);
