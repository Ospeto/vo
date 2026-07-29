import { describe, test, expect } from "bun:test";
import { analyzeAudioQuality, convertToMono, downsample } from "../../shared/audio-utils.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

describe("Microphone Input Quality & Diagnostics Pass Suite", () => {
  describe("1. Audio Format Conversion & Downsampling Contracts", () => {
    test("downsamples 48kHz stereo/mono audio to 16kHz Float32 PCM faithfully", () => {
      const pcm48k = new Float32Array(480);
      for (let i = 0; i < 480; i++) {
        pcm48k[i] = Math.sin((i / 480) * 2 * Math.PI * 5);
      }
      const pcm16k = downsample(pcm48k, 48000, 16000);
      expect(pcm16k.length).toBe(160);
      expect(pcm16k[0]).toBeCloseTo(0, 2);
    });

    test("converts stereo input to mono before processing", () => {
      const stereo = new Float32Array([0.5, -0.5, 0.2, 0.4]);
      const mono = convertToMono(stereo, 2);
      expect(mono.length).toBe(2);
      expect(mono[0]).toBe(0); // (0.5 + -0.5)/2
      expect(mono[1]).toBeCloseTo(0.3, 5); // (0.2 + 0.4)/2
    });
  });

  describe("2. Quality Detection & Threshold Calibration", () => {
    test("preserves valid quiet speech without false rejection", () => {
      // Soft speech signal (peak ~0.005, RMS ~0.002)
      const quietSpeech = new Float32Array(1600);
      for (let i = 0; i < 1600; i++) {
        quietSpeech[i] = Math.sin(i * 0.05) * 0.005;
      }
      const quality = analyzeAudioQuality(quietSpeech);
      expect(quality.status).toBe("valid");
      expect(quality.maxAbs).toBeGreaterThanOrEqual(0.002);
      expect(quality.rms).toBeGreaterThanOrEqual(0.001);
    });

    test("detects extremely quiet / dead microphone input before STT", () => {
      // Near-silent digital noise floor (peak < 0.001, RMS < 0.0005)
      const deadMic = new Float32Array(1600);
      for (let i = 0; i < 1600; i++) {
        deadMic[i] = (Math.random() - 0.5) * 0.001;
      }
      const quality = analyzeAudioQuality(deadMic);
      expect(quality.status).toBe("extremely_quiet");
      expect(quality.reason).toBe("Microphone input extremely quiet");
    });

    test("detects severely clipped microphone input", () => {
      // Clipped square wave at max amplitude
      const clippedMic = new Float32Array(1600);
      for (let i = 0; i < 1600; i++) {
        clippedMic[i] = i % 2 === 0 ? 1.0 : -1.0;
      }
      const quality = analyzeAudioQuality(clippedMic);
      expect(quality.status).toBe("clipped");
      expect(quality.reason).toBe("Microphone input clipped");
      expect(quality.clipRatio).toBeGreaterThan(0.05);
    });

    test("detects unavailable or disconnected microphone", () => {
      const unavailable = analyzeAudioQuality(new Float32Array([]), { deviceUnavailable: true });
      expect(unavailable.status).toBe("unavailable");
      expect(unavailable.reason).toBe("Microphone unavailable");

      const disconnected = analyzeAudioQuality(new Float32Array(500), { trackEnded: true });
      expect(disconnected.status).toBe("disconnected");
      expect(disconnected.reason).toBe("Microphone disconnected");
    });
  });

  describe("3. Recording State Machine Recovery on Subsequent Attempt", () => {
    test("recovers cleanly from an input error state on the next recording", () => {
      const lifecycle = new RecordingLifecycle();
      
      // 1. Start first recording
      const reqStart1 = lifecycle.requestStart();
      expect(reqStart1.accepted).toBe(true);
      const ackStart1 = lifecycle.acknowledgeStart(reqStart1.sequenceId, true);
      expect(ackStart1.accepted).toBe(true);
      expect(lifecycle.snapshot().state).toBe("recording");

      // 2. Encounter an input error during stop (e.g. quiet or clipped input rejected)
      const reqStop = lifecycle.requestStop();
      expect(reqStop.accepted).toBe(true);
      const ackStop = lifecycle.acknowledgeStop(reqStop.sequenceId, false);
      expect(ackStop.accepted).toBe(true);
      expect(lifecycle.snapshot().state).toBe("error");

      // 3. Settle / reset error state back to idle
      lifecycle.settle();
      expect(lifecycle.snapshot().state).toBe("idle");

      // 4. Next recording attempt starts cleanly without being trapped in busy/error state
      const reqStart2 = lifecycle.requestStart();
      expect(reqStart2.accepted).toBe(true);
      const ackStart2 = lifecycle.acknowledgeStart(reqStart2.sequenceId, true);
      expect(ackStart2.accepted).toBe(true);
      expect(lifecycle.snapshot().state).toBe("recording");
      expect(reqStart2.sequenceId).toBeGreaterThan(reqStart1.sequenceId);
    });
  });
});
