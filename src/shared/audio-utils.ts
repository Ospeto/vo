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
 * - Extremely quiet / near-silence (maxAbs < 0.008 && rms < 0.003)
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

  if (maxAbs < 0.008 && rms < 0.003) {
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
