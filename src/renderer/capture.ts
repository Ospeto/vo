import { IPC, type RecordingFormat } from "../shared/types.js";
import {
  analyzePcmFrame,
  SpeechEndpointDetector,
  diagnoseAudioStats,
  type AudioRecordingStats,
} from "../shared/audio-utils.js";
import { isAutoEndpointEnabled } from "../services/hold-mode-protections.js";

function getWindowApi(): any {
  if (typeof globalThis !== "undefined" && (globalThis as any).window) {
    return (globalThis as any).window;
  }
  if (typeof window !== "undefined") {
    return window;
  }
  return undefined;
}

let mediaStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;
let compressorNode: DynamicsCompressorNode | null = null;
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let meterInterval: any = null;
let currentGainValue = 1.0;
let recordingStartTime = 0;
let recordingGeneration = 0;
let postRollTimer: ReturnType<typeof setTimeout> | null = null;
let stopRequestedDuringStartup = false;
let activeSequenceId: number | undefined;

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
let tornDownGeneration = -1;

let sessionMaxAbs = 0;
let sessionClippedSamples = 0;
let sessionTotalSamples = 0;
let sessionTrackEnded = false;

let isStartingUp = false;

function sendRecordingError(error: string, sequenceId: number): void {
  const win = getWindowApi();
  if (win?.piVoice) {
    win.piVoice.sendRecordingError(error, sequenceId);
  }
}

function sendRecordingErrorOnce(generation: number, sequenceId: number, error: string): void {
  if (generation !== recordingGeneration || finalizedRecordingGeneration === generation) return;
  finalizedRecordingGeneration = generation;
  if (postRollTimer) {
    clearTimeout(postRollTimer);
    postRollTimer = null;
  }
  audioChunks = [];
  sendRecordingError(error, sequenceId);
  const win = getWindowApi();
  if (win?.piVoice) {
    win.piVoice.sendRecordingStartFailed?.(sequenceId, error);
  }
}

export function cleanupPartialPipeline(): void {
  teardownAudio(recordingGeneration);
}

export function resetAudioStateForTest(): void {
  tornDownGeneration = -1;
  teardownAudio();
  recordingGeneration = 0;
  tornDownGeneration = -1;
  finalizedRecordingGeneration = -1;
  stopRequestedDuringStartup = false;
  isStartingUp = false;
  activeSequenceId = undefined;
}

export function teardownAudio(generation?: number): void {
  const targetGen = generation ?? recordingGeneration;
  if (generation !== undefined && (targetGen > recordingGeneration || tornDownGeneration === targetGen)) {
    return;
  }
  tornDownGeneration = targetGen;

  if (postRollTimer) {
    clearTimeout(postRollTimer);
    postRollTimer = null;
  }
  stopMetering();

  if (mediaRecorder) {
    try {
      const rec = mediaRecorder;
      mediaRecorder = null;
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.onerror = null;
      if (rec.state !== "inactive") {
        rec.stop();
      }
    } catch {}
  }

  if (mediaStream) {
    try {
      mediaStream.getAudioTracks().forEach((track) => {
        track.onended = null;
        try {
          track.stop();
        } catch {}
      });
    } catch {}
    mediaStream = null;
  }

  try { gainNode?.disconnect(); } catch {}
  try { analyserNode?.disconnect(); } catch {}
  try { compressorNode?.disconnect(); } catch {}
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

  audioChunks = [];
  sessionMaxRms = 0;
  sessionPeakAmplitude = 0;
  sessionTotalFrames = 0;
  sessionSpeechFrames = 0;
  sessionClippingFrames = 0;
  sessionMaxAbs = 0;
  sessionClippedSamples = 0;
  sessionTotalSamples = 0;
  sessionTrackEnded = false;
  autoEndpointTriggered = false;
  isStartingUp = false;
  stopRequestedDuringStartup = false;

  if (activeSequenceId !== undefined && (generation === undefined || targetGen <= recordingGeneration)) {
    const seq = activeSequenceId;
    activeSequenceId = undefined;
    const win = getWindowApi();
    if (win?.piVoice) {
      win.piVoice.sendRecordingStopped?.(seq);
    }
  }
}

async function setupAudioPipeline(inputGain: number, sequenceId: number, generation: number): Promise<boolean> {
  let localStream: MediaStream | null = null;
  let localAudioCtx: AudioContext | null = null;
  let localGainNode: GainNode | null = null;
  let localAnalyserNode: AnalyserNode | null = null;
  let localCompressorNode: DynamicsCompressorNode | null = null;
  let localRecorder: MediaRecorder | null = null;

  const cleanupLocals = () => {
    try { localGainNode?.disconnect(); } catch {}
    try { localAnalyserNode?.disconnect(); } catch {}
    try { localCompressorNode?.disconnect(); } catch {}
    if (localAudioCtx && localAudioCtx.state !== "closed") {
      try { void localAudioCtx.close(); } catch {}
    }
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.onended = null;
        try { track.stop(); } catch {}
      });
    }
  };

  try {
    currentGainValue = inputGain;

    const win = getWindowApi();
    const config = win?.piVoice ? await win.piVoice.getConfig() : undefined;
    if (generation !== recordingGeneration) {
      cleanupLocals();
      return false;
    }

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
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { ...baseAudioConstraints, deviceId: { exact: targetDeviceId } },
        });
      } catch (err: any) {
        if (generation !== recordingGeneration) {
          cleanupLocals();
          return false;
        }
        console.warn(`Target audio device '${targetDeviceId}' unavailable (${err?.message}), falling back to system default.`);
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: baseAudioConstraints,
        });
      }
    } else {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: baseAudioConstraints,
      });
    }

    if (generation !== recordingGeneration) {
      cleanupLocals();
      return false;
    }

    if (!localStream || localStream.getAudioTracks().length === 0) {
      cleanupLocals();
      sendRecordingErrorOnce(generation, sequenceId, "Microphone input unavailable");
      teardownAudio(generation);
      return false;
    }

    localAudioCtx = new AudioContext({ sampleRate: 16000 });
    if (localAudioCtx.state === "suspended") {
      await localAudioCtx.resume();
    }

    if (generation !== recordingGeneration) {
      cleanupLocals();
      return false;
    }

    const source = localAudioCtx.createMediaStreamSource(localStream);

    localGainNode = localAudioCtx.createGain();
    localGainNode.gain.setValueAtTime(inputGain, localAudioCtx.currentTime);

    localAnalyserNode = localAudioCtx.createAnalyser();
    localAnalyserNode.fftSize = 256;

    localCompressorNode = localAudioCtx.createDynamicsCompressor();

    const destination = localAudioCtx.createMediaStreamDestination();

    source.connect(localGainNode);
    localGainNode.connect(localAnalyserNode);
    localGainNode.connect(localCompressorNode);
    localCompressorNode.connect(destination);

    localRecorder = new MediaRecorder(destination.stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 24000,
    });

    if (generation !== recordingGeneration) {
      cleanupLocals();
      return false;
    }

    localStream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (generation !== recordingGeneration) return;
        sessionTrackEnded = true;
        sendRecordingErrorOnce(generation, sequenceId, "Microphone disconnected");
        teardownAudio(generation);
      };
    });

    localRecorder.onerror = (event: any) => {
      if (generation !== recordingGeneration) return;
      const errorMsg = event.error?.message || event.error?.name || "Encoder failure";
      sendRecordingErrorOnce(generation, sequenceId, `MediaRecorder error: ${errorMsg}`);
      teardownAudio(generation);
    };

    if (generation !== recordingGeneration) {
      cleanupLocals();
      return false;
    }

    if (mediaStream || audioCtx || mediaRecorder) {
      if (mediaRecorder) {
        try {
          mediaRecorder.ondataavailable = null;
          mediaRecorder.onstop = null;
          mediaRecorder.onerror = null;
          if (mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
          }
        } catch {}
        mediaRecorder = null;
      }

      if (mediaStream) {
        try {
          mediaStream.getAudioTracks().forEach((track) => {
            track.onended = null;
            try {
              track.stop();
            } catch {}
          });
        } catch {}
        mediaStream = null;
      }

      try { gainNode?.disconnect(); } catch {}
      try { analyserNode?.disconnect(); } catch {}
      try { compressorNode?.disconnect(); } catch {}
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

    mediaStream = localStream;
    audioCtx = localAudioCtx;
    gainNode = localGainNode;
    analyserNode = localAnalyserNode;
    compressorNode = localCompressorNode;
    mediaRecorder = localRecorder;

    startMetering(generation);
    return true;
  } catch (err: any) {
    cleanupLocals();
    sendRecordingErrorOnce(generation, sequenceId, `Microphone access error: ${err?.message || err}`);
    teardownAudio(generation);
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

function startMetering(generation: number) {
  if (meterInterval) clearInterval(meterInterval);

  const buffer = new Float32Array(128);
  let smoothedLevel = 0;

  meterInterval = setInterval(() => {
    if (generation !== recordingGeneration || !analyserNode) {
      stopMetering();
      return;
    }
    analyserNode.getFloatTimeDomainData(buffer);

    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      const val = buffer[i] ?? 0;
      const qualityVal = currentGainValue > 0 ? val / currentGainValue : val;
      const absVal = Math.abs(qualityVal);
      if (generation === recordingGeneration && mediaRecorder && mediaRecorder.state === "recording") {
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

    if (generation === recordingGeneration && mediaRecorder && mediaRecorder.state === "recording") {
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
          triggerAutoStop(generation);
        }
      }
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    if (generation === recordingGeneration && mediaRecorder && mediaRecorder.state === "recording") {
      if (rms > sessionMaxRms) sessionMaxRms = rms;
    }

    const rmsDb = Math.max(-60, Math.min(0, 20 * Math.log10(metrics.rms || 0.0001)));
    const targetLevel = Math.max(0, Math.min(100, Math.round(((rmsDb + 60) / 60) * 100)));

    if (targetLevel > smoothedLevel) {
      smoothedLevel = smoothedLevel + 0.8 * (targetLevel - smoothedLevel);
    } else {
      smoothedLevel = smoothedLevel + 0.2 * (targetLevel - smoothedLevel);
    }

    const barCount = 16;
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(freqData);
    const step = Math.floor(freqData.length / barCount);
    const spectrum: number[] = [];
    for (let i = 0; i < barCount; i++) {
      spectrum.push(freqData[i * step] || 0);
    }

    const win = getWindowApi();
    if (generation === recordingGeneration && win?.piVoice) {
      win.piVoice.sendAudioLevelUpdate({ level: Math.round(smoothedLevel), spectrum });
    }
  }, 50);
}

function stopMetering() {
  if (meterInterval) {
    clearInterval(meterInterval);
    meterInterval = null;
  }
}

function triggerAutoStop(generation: number) {
  if (generation !== recordingGeneration || !mediaRecorder || mediaRecorder.state === "inactive") return;
  if (postRollTimer) clearTimeout(postRollTimer);
  postRollTimer = setTimeout(() => {
    if (generation !== recordingGeneration) return;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }, 250);
}

async function finalizeRecording(generation: number, sequenceId: number) {
  if (generation !== recordingGeneration || finalizedRecordingGeneration === generation) return;
  finalizedRecordingGeneration = generation;
  if (postRollTimer) {
    clearTimeout(postRollTimer);
    postRollTimer = null;
  }

  if (sessionTrackEnded || !mediaStream || !mediaStream.active || mediaStream.getAudioTracks().every((t) => t.readyState === "ended")) {
    sendRecordingError("Microphone disconnected", sequenceId);
    audioChunks = [];
    teardownAudio(generation);
    return;
  }

  const clipRatio = sessionTotalSamples > 0 ? sessionClippedSamples / sessionTotalSamples : 0;
  if (sessionMaxAbs >= 0.99 && (clipRatio > 0.05 || sessionClippedSamples > 50)) {
    sendRecordingError("Microphone input clipped", sequenceId);
    audioChunks = [];
    teardownAudio(generation);
    return;
  }

  if (sessionMaxAbs < 0.002 && sessionMaxRms < 0.001) {
    sendRecordingError("Microphone input extremely quiet", sequenceId);
    audioChunks = [];
    teardownAudio(generation);
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
    sendRecordingError("Microphone input clipped or distorted", sequenceId);
    audioChunks = [];
    teardownAudio(generation);
    return;
  }
  if (diag.status === "near_silence") {
    sendRecordingError("No speech detected (silent audio)", sequenceId);
    audioChunks = [];
    teardownAudio(generation);
    return;
  }
  if (diag.status === "too_short") {
    sendRecordingError("Recording too short", sequenceId);
    audioChunks = [];
    teardownAudio(generation);
    return;
  }

  const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
  audioChunks = [];
  teardownAudio(generation);
  if (generation !== recordingGeneration) return;
  const arrayBuffer = await audioBlob.arrayBuffer();
  if (generation !== recordingGeneration) return;
  const win = getWindowApi();
  if (win?.piVoice) {
    win.piVoice.sendRecordingData(arrayBuffer);
  }
}

function stopRecording(ensureMinimumDuration = false) {
  try {
    const generation = recordingGeneration;
    const sequenceId = activeSequenceId;
    if (sequenceId === undefined) return;
    if (finalizedRecordingGeneration === generation) return;

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      if (isStartingUp) {
        stopRequestedDuringStartup = true;
        return;
      }
      sendRecordingErrorOnce(generation, sequenceId, "Recorder inactive");
      teardownAudio(generation);
      return;
    }

    const doStop = () => {
      if (postRollTimer) clearTimeout(postRollTimer);
      postRollTimer = setTimeout(() => {
        postRollTimer = null;
        if (generation !== recordingGeneration || finalizedRecordingGeneration === generation) return;
        if (!mediaRecorder || mediaRecorder.state === "inactive") return;
        try {
          mediaRecorder.stop();
        } catch (err: any) {
          sendRecordingErrorOnce(generation, sequenceId, `MediaRecorder stop failed: ${err.message}`);
          teardownAudio(generation);
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
    const sequenceId = activeSequenceId;
    if (sequenceId !== undefined) {
      sendRecordingErrorOnce(recordingGeneration, sequenceId, `MediaRecorder stop failed: ${err.message}`);
      teardownAudio(recordingGeneration);
    }
  }
}

export function registerCaptureListeners(): void {
  const win = getWindowApi();
  if (!win) return;

  win.getAnalyserNode = () => analyserNode;
  win.teardownAudio = teardownAudio;

  win.piVoice?.onGainUpdate?.((newGain: number) => {
    currentGainValue = newGain;
    if (gainNode && audioCtx) {
      gainNode.gain.setValueAtTime(newGain, audioCtx.currentTime);
    }
  });

  win.piVoice?.onStartRecording?.(async (format: RecordingFormat, inputGain: number, sequenceId: number) => {
    const generation = ++recordingGeneration;
    activeSequenceId = sequenceId;
    stopRequestedDuringStartup = false;
    isStartingUp = true;
    finalizedRecordingGeneration = -1;
    audioChunks = [];
    currentGainValue = inputGain;

    try {
      const activeWin = getWindowApi();
      const genBefore = recordingGeneration;
      const config = activeWin?.piVoice ? await activeWin.piVoice.getConfig() : undefined;
      if (generation !== recordingGeneration) {
        console.error(`GEN MISMATCH: gen=${generation}, genBefore=${genBefore}, currentGen=${recordingGeneration}, seq=${sequenceId}`);
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

      const ok = await setupAudioPipeline(inputGain, sequenceId, generation);
      if (!ok || generation !== recordingGeneration) {
        isStartingUp = false;
        if (generation === recordingGeneration && finalizedRecordingGeneration !== generation) {
          sendRecordingErrorOnce(generation, sequenceId, "Microphone setup failed");
          teardownAudio(generation);
        }
        return;
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
        mediaRecorder.onstop = () => { void finalizeRecording(generation, sequenceId); };
        mediaRecorder.start(100);
        recordingStartTime = Date.now();
        isStartingUp = false;

        const liveWin = getWindowApi();
        if (liveWin?.piVoice) {
          liveWin.piVoice.sendRecordingStartReady?.(sequenceId);
        }

        if (stopRequestedDuringStartup && generation === recordingGeneration) {
          stopRequestedDuringStartup = false;
          stopRecording(true);
        }
      } else {
        isStartingUp = false;
        sendRecordingErrorOnce(generation, sequenceId, "MediaRecorder not ready");
        teardownAudio(generation);
      }
    } catch (err: any) {
      isStartingUp = false;
      stopRequestedDuringStartup = false;
      sendRecordingErrorOnce(generation, sequenceId, `MediaRecorder start failed: ${err?.message || err}`);
      teardownAudio(generation);
    }
  });

  win.piVoice?.onCancelRecording?.(() => {
    const currentGen = recordingGeneration;
    recordingGeneration++;
    teardownAudio(currentGen);
  });

  if (typeof window !== "undefined" && typeof (window as any).addEventListener === "function") {
    window.addEventListener("beforeunload", () => {
      cleanupPartialPipeline();
    });
  }

  win.piVoice?.onStopRecording?.(stopRecording);
}

registerCaptureListeners();
