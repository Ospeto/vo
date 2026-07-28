import { describe, test, expect } from "bun:test";
import { downsample, convertToMono, analyzeAudioQuality } from "../../shared/audio-utils.js";

describe("downsample", () => {
  test("returns same buffer when sample rates match", () => {
    const input = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const result = downsample(input, 48000, 48000);
    expect(result).toBe(input); // same reference
  });

  test("downsamples 48kHz to 16kHz (3:1 ratio)", () => {
    // 6 samples at 48kHz -> 2 samples at 16kHz
    const input = new Float32Array([0.0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    const result = downsample(input, 48000, 16000);
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo(0.0, 5);
    expect(result[1]).toBeCloseTo(0.3, 5);
  });

  test("upsamples 16kHz to 48kHz (1:3 ratio)", () => {
    const input = new Float32Array([0.0, 1.0]);
    const result = downsample(input, 16000, 48000);
    expect(result.length).toBe(6);
    expect(result[0]).toBeCloseTo(0.0, 5);
    expect(result[result.length - 1]!).toBeCloseTo(1.0, 1);
  });

  test("handles empty buffer", () => {
    const input = new Float32Array([]);
    const result = downsample(input, 48000, 16000);
    expect(result.length).toBe(0);
  });

  test("handles single sample", () => {
    const input = new Float32Array([0.5]);
    const result = downsample(input, 48000, 16000);
    expect(result.length).toBeLessThanOrEqual(1);
  });

  test("preserves signal characteristics roughly", () => {
    const input = new Float32Array(300);
    for (let i = 0; i < 300; i++) {
      input[i] = i / 300;
    }
    const result = downsample(input, 48000, 16000);
    expect(result.length).toBe(100);
    expect(result[0]).toBeCloseTo(0, 2);
    expect(result[99]!).toBeCloseTo(0.99, 1);
  });
});

describe("convertToMono", () => {
  test("returns original buffer for mono input", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const result = convertToMono(input, 1);
    expect(result).toBe(input);
  });

  test("averages stereo channels correctly", () => {
    // Stereo interleaved: [L1, R1, L2, R2]
    const stereo = new Float32Array([0.4, 0.8, -0.2, 0.6]);
    const mono = convertToMono(stereo, 2);
    expect(mono.length).toBe(2);
    expect(mono[0]).toBeCloseTo(0.6, 5); // (0.4 + 0.8)/2
    expect(mono[1]).toBeCloseTo(0.2, 5); // (-0.2 + 0.6)/2
  });
});

describe("analyzeAudioQuality", () => {
  test("detects unavailable microphone", () => {
    const samples = new Float32Array([]);
    const metrics = analyzeAudioQuality(samples, { deviceUnavailable: true });
    expect(metrics.status).toBe("unavailable");
    expect(metrics.reason).toContain("unavailable");
  });

  test("detects disconnected microphone on track ended or empty buffer", () => {
    const samples = new Float32Array(1000); // silent zeros
    const metricsEnded = analyzeAudioQuality(samples, { trackEnded: true });
    expect(metricsEnded.status).toBe("disconnected");

    const metricsEmpty = analyzeAudioQuality(new Float32Array([]));
    expect(metricsEmpty.status).toBe("disconnected");
  });

  test("detects extremely quiet / near-silence input", () => {
    // Very quiet digital noise floor (max peak 0.002, RMS ~0.0005)
    const quietSamples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      quietSamples[i] = (Math.random() - 0.5) * 0.004;
    }
    const metrics = analyzeAudioQuality(quietSamples);
    expect(metrics.status).toBe("extremely_quiet");
    expect(metrics.reason).toBe("Microphone input extremely quiet");
  });

  test("preserves valid quiet speech and normal dictation", () => {
    // Quiet speech signal (peak 0.03, RMS ~0.01)
    const validQuietSamples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      validQuietSamples[i] = Math.sin(i * 0.1) * 0.03;
    }
    const metrics = analyzeAudioQuality(validQuietSamples);
    expect(metrics.status).toBe("valid");
    expect(metrics.maxAbs).toBeCloseTo(0.03, 2);

    // Normal speech signal (peak 0.4, RMS ~0.15)
    const normalSamples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      normalSamples[i] = Math.sin(i * 0.1) * 0.4;
    }
    const normalMetrics = analyzeAudioQuality(normalSamples);
    expect(normalMetrics.status).toBe("valid");
  });

  test("detects clipped input when amplitude saturates", () => {
    // Severely clipped signal (square wave at 1.0)
    const clippedSamples = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      clippedSamples[i] = i % 2 === 0 ? 1.0 : -1.0;
    }
    const metrics = analyzeAudioQuality(clippedSamples);
    expect(metrics.status).toBe("clipped");
    expect(metrics.reason).toBe("Microphone input clipped");
    expect(metrics.clippedSampleCount).toBe(1000);
  });
});
