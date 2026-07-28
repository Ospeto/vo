import { IPC, type RecordingFormat } from "../shared/types.js";
import { analyzeAudioQuality } from "../shared/audio-utils.js";

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

let sessionMaxAbs = 0;
let sessionMaxRms = 0;
let sessionClippedSamples = 0;
let sessionTotalSamples = 0;
let sessionTrackEnded = false;

async function setupAudioPipeline(inputGain: number = 1.0): Promise<boolean> {
  try {
    currentGainValue = inputGain;
    
    const config = await window.electronIPC?.getConfig();
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
            window.electronIPC?.sendRecordingError("Microphone disconnected");
          }
        };
      });
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
    window.electronIPC?.sendRecordingError(`Microphone access error: ${err.message}`);
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
      const absVal = Math.abs(val);
      if (mediaRecorder && mediaRecorder.state === "recording") {
        if (absVal > sessionMaxAbs) sessionMaxAbs = absVal;
        if (absVal >= 0.99) sessionClippedSamples++;
        sessionTotalSamples++;
      }
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    if (mediaRecorder && mediaRecorder.state === "recording") {
      if (rms > sessionMaxRms) sessionMaxRms = rms;
    }
    
    // Smooth logarithmic dB scale normalized to [0, 100%]
    const rmsDb = Math.max(-60, Math.min(0, 20 * Math.log10(rms || 0.0001)));
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

    window.electronIPC?.sendAudioLevelUpdate({ level: Math.round(smoothedLevel), spectrum });
  }, 50);
}

function stopMetering() {
  if (meterInterval) {
    clearInterval(meterInterval);
    meterInterval = null;
  }
}

(window as any).getAnalyserNode = () => analyserNode;

(window.electronIPC as any)?.onGainUpdate((newGain: number) => {
  currentGainValue = newGain;
  if (gainNode && audioCtx) {
    gainNode.gain.setValueAtTime(newGain, audioCtx.currentTime);
  }
});

window.electronIPC?.onStartRecording(async (format: RecordingFormat, inputGain: number) => {
  const generation = ++recordingGeneration;
  audioChunks = [];
  currentGainValue = inputGain;
  recordingStartTime = Date.now();

  sessionMaxAbs = 0;
  sessionMaxRms = 0;
  sessionClippedSamples = 0;
  sessionTotalSamples = 0;
  sessionTrackEnded = false;

  const isStreamValid = mediaStream && mediaStream.active && mediaStream.getAudioTracks().some((t) => t.readyState === "live");

  if (!isStreamValid) {
    mediaStream = null;
    const ok = await setupAudioPipeline(inputGain);
    if (!ok || generation !== recordingGeneration) return;
  } else if (gainNode && audioCtx) {
    gainNode.gain.setValueAtTime(inputGain, audioCtx.currentTime);
  }

  if (audioCtx?.state === "suspended") {
    await audioCtx.resume();
  }

  if (generation !== recordingGeneration) return;

  try {
    if (mediaRecorder && mediaRecorder.state === "inactive") {
      mediaRecorder.ondataavailable = (event) => {
        if (generation === recordingGeneration && event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      mediaRecorder.onstop = async () => {
        if (generation !== recordingGeneration) return;

        if (sessionTrackEnded || !mediaStream || !mediaStream.active || mediaStream.getAudioTracks().every((t) => t.readyState === "ended")) {
          window.electronIPC?.sendRecordingError("Microphone disconnected");
          audioChunks = [];
          return;
        }

        const clipRatio = sessionTotalSamples > 0 ? sessionClippedSamples / sessionTotalSamples : 0;
        if (sessionMaxAbs >= 0.99 && (clipRatio > 0.05 || sessionClippedSamples > 50)) {
          window.electronIPC?.sendRecordingError("Microphone input clipped");
          audioChunks = [];
          return;
        }

        if (sessionMaxAbs < 0.008 && sessionMaxRms < 0.003) {
          window.electronIPC?.sendRecordingError("Microphone input extremely quiet");
          audioChunks = [];
          return;
        }

        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        const arrayBuffer = await audioBlob.arrayBuffer();
        if (generation !== recordingGeneration) return;
        window.electronIPC?.sendRecordingData(arrayBuffer);
        audioChunks = [];
      };
      mediaRecorder.start(100);
    }
  } catch (err: any) {
    window.electronIPC?.sendRecordingError(`MediaRecorder start failed: ${err.message}`);
  }
});

(window.electronIPC as any)?.onCancelRecording(() => {
  recordingGeneration++;
  try {
    if (mediaRecorder) {
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    }
  } catch {}
  audioChunks = [];
});

window.electronIPC?.onStopRecording(() => {
  const generation = recordingGeneration;
  try {
    if (!mediaRecorder) {
      window.electronIPC?.sendRecordingError("No media recorder instance");
      return;
    }

    const doStop = () => {
      // Allow 150ms for final WebAudio speech tail chunk to flush into MediaRecorder
      setTimeout(() => {
        if (generation !== recordingGeneration) return;
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        } else {
          if (sessionTrackEnded || !mediaStream || !mediaStream.active || mediaStream.getAudioTracks().every((t) => t.readyState === "ended")) {
            window.electronIPC?.sendRecordingError("Microphone disconnected");
            audioChunks = [];
            return;
          }

          const clipRatio = sessionTotalSamples > 0 ? sessionClippedSamples / sessionTotalSamples : 0;
          if (sessionMaxAbs >= 0.99 && (clipRatio > 0.05 || sessionClippedSamples > 50)) {
            window.electronIPC?.sendRecordingError("Microphone input clipped");
            audioChunks = [];
            return;
          }

          if (sessionMaxAbs < 0.008 && sessionMaxRms < 0.003) {
            window.electronIPC?.sendRecordingError("Microphone input extremely quiet");
            audioChunks = [];
            return;
          }

          const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          audioBlob.arrayBuffer().then((buf) => {
            if (generation !== recordingGeneration) return;
            window.electronIPC?.sendRecordingData(buf);
            audioChunks = [];
          });
        }
      }, 150);
    };

    const elapsed = Date.now() - recordingStartTime;
    if (elapsed < 300) {
      setTimeout(() => {
        if (generation === recordingGeneration) doStop();
      }, 300 - elapsed);
    } else {
      doStop();
    }
  } catch (err: any) {
    window.electronIPC?.sendRecordingError(`MediaRecorder stop failed: ${err.message}`);
  }
});
