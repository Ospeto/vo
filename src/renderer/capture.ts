import { IPC, type RecordingFormat } from "../shared/types.js";

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

async function setupAudioPipeline(inputGain: number = 1.0): Promise<boolean> {
  try {
    currentGainValue = inputGain;
    
    // Explicitly disable autoGainControl for predictable manual user gain control
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    audioCtx = new AudioContext();
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

    // Setup MediaRecorder using processed destination stream
    mediaRecorder = new MediaRecorder(destination.stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      const arrayBuffer = await audioBlob.arrayBuffer();
      window.electronIPC?.sendRecordingData(arrayBuffer);
      audioChunks = [];
    };

    startMetering();
    return true;
  } catch (err: any) {
    window.electronIPC?.sendRecordingError(`Microphone access error: ${err.message}`);
    return false;
  }
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
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    
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
    const freqData = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(freqData);

    const barCount = 16;
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
  audioChunks = [];
  currentGainValue = inputGain;
  recordingStartTime = Date.now();

  if (!mediaStream) {
    const ok = await setupAudioPipeline(inputGain);
    if (!ok) return;
  } else if (gainNode && audioCtx) {
    gainNode.gain.setValueAtTime(inputGain, audioCtx.currentTime);
  }

  if (audioCtx?.state === "suspended") {
    await audioCtx.resume();
  }

  try {
    if (mediaRecorder && mediaRecorder.state === "inactive") {
      mediaRecorder.start(100);
    }
  } catch (err: any) {
    window.electronIPC?.sendRecordingError(`MediaRecorder start failed: ${err.message}`);
  }
});

window.electronIPC?.onStopRecording(() => {
  try {
    if (!mediaRecorder) {
      window.electronIPC?.sendRecordingError("No media recorder instance");
      return;
    }

    const doStop = () => {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      } else {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        audioBlob.arrayBuffer().then((buf) => {
          window.electronIPC?.sendRecordingData(buf);
          audioChunks = [];
        });
      }
    };

    const elapsed = Date.now() - recordingStartTime;
    if (elapsed < 200) {
      setTimeout(doStop, 200 - elapsed);
    } else {
      doStop();
    }
  } catch (err: any) {
    window.electronIPC?.sendRecordingError(`MediaRecorder stop failed: ${err.message}`);
  }
});
