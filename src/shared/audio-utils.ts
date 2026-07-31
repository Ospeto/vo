export const MAX_RECORDING_DURATION_MS = 300_000;
export const MAX_RECORDING_CHUNKS = 3_600;
export const MAX_RECORDING_BYTE_SIZE = 15 * 1024 * 1024;
export const MAX_STT_PAYLOAD_BYTES = 15 * 1024 * 1024;
export const MIN_STT_PAYLOAD_BYTES = 1000;

export const WEBM_EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;

export function isValidWebmHeader(buffer: unknown): boolean {
  if (!buffer || typeof buffer !== "object") return false;
  let bytes: Uint8Array;
  if (buffer instanceof Uint8Array) {
    bytes = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(buffer);
  } else if (ArrayBuffer.isView(buffer)) {
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else {
    return false;
  }
  if (bytes.byteLength < 4) return false;
  return (
    bytes[0] === WEBM_EBML_MAGIC[0] &&
    bytes[1] === WEBM_EBML_MAGIC[1] &&
    bytes[2] === WEBM_EBML_MAGIC[2] &&
    bytes[3] === WEBM_EBML_MAGIC[3]
  );
}

export const WEBM_OPUS_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export function getBestSupportedMimeType(
  isTypeSupportedFn?: (type: string) => boolean
): string | null {
  const checkFn =
    isTypeSupportedFn ??
    (typeof MediaRecorder !== "undefined" && typeof (MediaRecorder as any).isTypeSupported === "function"
      ? (type: string) => (MediaRecorder as any).isTypeSupported(type)
      : undefined);

  if (!checkFn) return null;

  for (const mime of WEBM_OPUS_MIME_CANDIDATES) {
    try {
      if (checkFn(mime)) {
        return mime;
      }
    } catch {}
  }
  return null;
}

/**
 * Pure audio utility functions (no DOM / Web Audio dependency).
 * Extracted for testability across main, renderer, and services.
 */

export interface AudioQualityMetrics {
  maxAbs: number;
  rms: number;
  clippedSampleCount: number;
  totalSamples: number;
  clipRatio: number;
  status: "valid" | "extremely_quiet" | "clipped" | "unavailable" | "disconnected";
  reason?: string;
}

export interface AudioFrameMetrics {
  rms: number;
  peak: number;
  isSilent: boolean;
  isSpeech: boolean;
  isClipped: boolean;
}

export interface AudioRecordingStats {
  durationMs: number;
  maxRms: number;
  peakAmplitude: number;
  speechFrames: number;
  totalFrames: number;
  clippingFrames: number;
  hasSpeech: boolean;
}

export interface AudioDiagnosticResult {
  status: "valid_speech" | "near_silence" | "clipped" | "too_short" | "unavailable";
  message: string;
}

export interface EndpointDetectorConfig {
  speechThresholdRms?: number;
  silenceThresholdRms?: number;
  minSpeechDurationMs?: number;
  confirmSilenceMs?: number;
  frameIntervalMs?: number;
}

/**
 * Calculate RMS, peak amplitude, and frame flags for Float32 PCM sample buffer.
 */
export function analyzePcmFrame(
  samples: Float32Array,
  speechThresholdRms = 0.005,
  silenceThresholdRms = 0.004,
  clippingThreshold = 0.99
): AudioFrameMetrics {
  if (!samples || samples.length === 0) {
    return { rms: 0, peak: 0, isSilent: true, isSpeech: false, isClipped: false };
  }

  let sumSquares = 0;
  let peak = 0;
  let clippedCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const val = samples[i] ?? 0;
    const abs = Math.abs(val);
    if (abs > peak) peak = abs;
    if (abs >= clippingThreshold) clippedCount++;
    sumSquares += val * val;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const isClipped = clippedCount > samples.length * 0.1;
  const isSpeech = rms >= speechThresholdRms;
  const isSilent = rms < silenceThresholdRms;

  return { rms, peak, isSilent, isSpeech, isClipped };
}

/**
 * Pure class for tracking utterance speech and silence endpointing state across frames.
 */
export class SpeechEndpointDetector {
  private speechThresholdRms: number;
  private silenceThresholdRms: number;
  private minSpeechFrames: number;
  private confirmSilenceFrames: number;

  private speechFrameCount = 0;
  private consecutiveSilenceFrames = 0;
  private hasDetectedSpeech = false;
  private isEndpointed = false;

  constructor(config?: EndpointDetectorConfig) {
    this.speechThresholdRms = config?.speechThresholdRms ?? 0.005;
    this.silenceThresholdRms = config?.silenceThresholdRms ?? 0.004;
    const frameIntervalMs = config?.frameIntervalMs ?? 50;
    const minSpeechMs = config?.minSpeechDurationMs ?? 150;
    const confirmSilenceMs = config?.confirmSilenceMs ?? 800;

    this.minSpeechFrames = Math.max(1, Math.ceil(minSpeechMs / frameIntervalMs));
    this.confirmSilenceFrames = Math.max(1, Math.ceil(confirmSilenceMs / frameIntervalMs));
  }

  reset(): void {
    this.speechFrameCount = 0;
    this.consecutiveSilenceFrames = 0;
    this.hasDetectedSpeech = false;
    this.isEndpointed = false;
  }

  processFrame(rms: number): {
    hasDetectedSpeech: boolean;
    isEndpointed: boolean;
    speechRatio: number;
  } {
    if (this.isEndpointed) {
      return {
        hasDetectedSpeech: this.hasDetectedSpeech,
        isEndpointed: true,
        speechRatio: 1,
      };
    }

    if (rms >= this.speechThresholdRms) {
      this.speechFrameCount++;
      this.consecutiveSilenceFrames = 0;
      if (this.speechFrameCount >= this.minSpeechFrames) {
        this.hasDetectedSpeech = true;
      }
    } else if (rms < this.silenceThresholdRms) {
      if (this.hasDetectedSpeech) {
        this.consecutiveSilenceFrames++;
        if (this.consecutiveSilenceFrames >= this.confirmSilenceFrames) {
          this.isEndpointed = true;
        }
      }
    }

    return {
      hasDetectedSpeech: this.hasDetectedSpeech,
      isEndpointed: this.isEndpointed,
      speechRatio: Math.min(1, this.speechFrameCount / this.minSpeechFrames),
    };
  }

  getStatus() {
    return {
      hasDetectedSpeech: this.hasDetectedSpeech,
      isEndpointed: this.isEndpointed,
      consecutiveSilenceFrames: this.consecutiveSilenceFrames,
      speechFrameCount: this.speechFrameCount,
    };
  }
}

/**
 * Diagnose recorded audio statistics and return an actionable status.
 */
export function diagnoseAudioStats(stats: AudioRecordingStats): AudioDiagnosticResult {
  if (stats.durationMs < 300) {
    return { status: "too_short", message: "Recording too short" };
  }
  if (stats.maxRms < 0.001) {
    return { status: "near_silence", message: "No speech detected (silent audio)" };
  }
  if (stats.totalFrames > 0 && stats.clippingFrames / stats.totalFrames > 0.4) {
    return { status: "clipped", message: "Microphone input clipped or distorted" };
  }
  return { status: "valid_speech", message: "Valid speech audio" };
}
/**
 * Downsample Float32 PCM from sourceSampleRate to targetSampleRate using
 * simple linear interpolation. Good enough for speech.
 */
export function downsample(
  buffer: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate === targetSampleRate) return buffer;
  const ratio = sourceSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const lo = Math.floor(srcIndex);
    const hi = Math.min(lo + 1, buffer.length - 1);
    const frac = srcIndex - lo;
    result[i] = (buffer[lo] ?? 0) * (1 - frac) + (buffer[hi] ?? 0) * frac;
  }
  return result;
}

/**
 * Convert multi-channel (e.g. stereo) Float32Array PCM to mono by averaging channels.
 */
export function convertToMono(buffer: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return buffer;
  const samplesPerChannel = Math.floor(buffer.length / channels);
  const mono = new Float32Array(samplesPerChannel);
  for (let i = 0; i < samplesPerChannel; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += buffer[i * channels + c] ?? 0;
    }
    mono[i] = sum / channels;
  }
  return mono;
}

/**
 * Analyzes Float32 PCM audio data for input quality issues:
 * - Unavailable / disconnected (empty buffer or explicitly flagged track)
 * - Extremely quiet / near-silence (maxAbs < 0.002 && rms < 0.001)
 * - Clipped input (maxAbs >= 0.99 && (clipRatio > 0.05 || clippedCount > 50))
 * - Valid input (normal speech or quiet-but-valid speech)
 */
export function analyzeAudioQuality(
  samples: Float32Array,
  options: { trackEnded?: boolean; deviceUnavailable?: boolean } = {}
): AudioQualityMetrics {
  if (options.deviceUnavailable) {
    return {
      maxAbs: 0,
      rms: 0,
      clippedSampleCount: 0,
      totalSamples: 0,
      clipRatio: 0,
      status: "unavailable",
      reason: "Microphone unavailable",
    };
  }

  if (options.trackEnded || samples.length === 0) {
    return {
      maxAbs: 0,
      rms: 0,
      clippedSampleCount: 0,
      totalSamples: samples.length,
      clipRatio: 0,
      status: "disconnected",
      reason: "Microphone disconnected",
    };
  }

  let maxAbs = 0;
  let sumSquares = 0;
  let clippedCount = 0;
  const total = samples.length;

  for (let i = 0; i < total; i++) {
    const val = samples[i] ?? 0;
    const absVal = Math.abs(val);
    if (absVal > maxAbs) maxAbs = absVal;
    sumSquares += val * val;
    if (absVal >= 0.99) {
      clippedCount++;
    }
  }

  const rms = Math.sqrt(sumSquares / total);
  const clipRatio = total > 0 ? clippedCount / total : 0;

  if (maxAbs >= 0.99 && (clipRatio > 0.05 || clippedCount > 50)) {
    return {
      maxAbs,
      rms,
      clippedSampleCount: clippedCount,
      totalSamples: total,
      clipRatio,
      status: "clipped",
      reason: "Microphone input clipped",
    };
  }

  if (maxAbs < 0.002 && rms < 0.001) {
    return {
      maxAbs,
      rms,
      clippedSampleCount: clippedCount,
      totalSamples: total,
      clipRatio,
      status: "extremely_quiet",
      reason: "Microphone input extremely quiet",
    };
  }

  return {
    maxAbs,
    rms,
    clippedSampleCount: clippedCount,
    totalSamples: total,
    clipRatio,
    status: "valid",
  };
}
