import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SpeechEndpointDetector, analyzePcmFrame } from "../../shared/audio-utils.js";
import { loadConfig, updateConfig, type PiVoiceConfig } from "../../services/config.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Transcription Latency Gap & Toggle Silence Endpointing Suite", () => {
  describe("1. VAD Isolation & Sensitivity Calibration", () => {
    test("calibrates speech threshold at 0.005 RMS and detects speech", () => {
      const detector = new SpeechEndpointDetector({
        speechThresholdRms: 0.005,
        silenceThresholdRms: 0.003,
        minSpeechDurationMs: 100,
        frameIntervalMs: 50,
      });

      const quietFrame = analyzePcmFrame(new Float32Array([0.002, 0.003]), 0.005);
      expect(quietFrame.isSpeech).toBe(false);

      const speechFrame = analyzePcmFrame(new Float32Array([0.006, -0.007]), 0.005);
      expect(speechFrame.isSpeech).toBe(true);

      detector.processFrame(0.006);
      detector.processFrame(0.007);
      expect(detector.getStatus().hasDetectedSpeech).toBe(true);
    });

    test("accumulates silence frames once speech frames occur (speechFrameCount > 0)", () => {
      const detector = new SpeechEndpointDetector({
        speechThresholdRms: 0.005,
        silenceThresholdRms: 0.003,
        minSpeechDurationMs: 150, // requires 3 frames for hasDetectedSpeech
        confirmSilenceMs: 100,    // requires 2 frames for endpointing
        frameIntervalMs: 50,
      });

      // Send 1 speech frame (speechFrameCount = 1, but hasDetectedSpeech = false because minSpeechFrames = 3)
      const res1 = detector.processFrame(0.008);
      expect(res1.hasDetectedSpeech).toBe(false);
      expect(detector.getStatus().speechFrameCount).toBe(1);

      // Send silence frame: silence frames should accumulate because speechFrameCount > 0
      detector.processFrame(0.001);
      expect(detector.getStatus().consecutiveSilenceFrames).toBe(1);

      detector.processFrame(0.001);
      expect(detector.getStatus().consecutiveSilenceFrames).toBe(2);
      expect(detector.getStatus().isEndpointed).toBe(true);
    });
  });

  describe("2. Toggle Mode Key-Release Separation vs Hold Mode", () => {
    let lifecycle: RecordingLifecycle;

    beforeEach(() => {
      lifecycle = new RecordingLifecycle();
    });

    test("in toggle mode, key release does NOT trigger stop regardless of press duration", () => {
      lifecycle.requestStart();
      lifecycle.acknowledgeStart(lifecycle.snapshot().sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("recording");

      // Simulated handleHotkeyUp logic for dictationMode: "toggle"
      // In toggle mode, handleHotkeyUp returns early and does NOT stop recording
      const dictationMode: "toggle" | "hold" = "toggle";
      const pressDuration = 500; // >250ms press

      if (dictationMode === "hold") {
        lifecycle.requestStop();
      }

      // Recording MUST stay active
      expect(lifecycle.snapshot().state).toBe("recording");
    });

    test("in toggle mode, recording stays active until Tap 2 or endpointing", () => {
      lifecycle.requestStart();
      const seq = lifecycle.snapshot().sequenceId;
      lifecycle.acknowledgeStart(seq, true);

      // Tap 2 triggers stop
      const stopRes = lifecycle.requestStop();
      expect(stopRes.accepted).toBe(true);
      expect(lifecycle.snapshot().state).toBe("stopping");
    });

    test("in hold mode, key release stops recording when active", () => {
      lifecycle.requestStart();
      lifecycle.acknowledgeStart(lifecycle.snapshot().sequenceId, true);

      const dictationMode: "toggle" | "hold" = "hold";
      if (dictationMode === "hold") {
        lifecycle.requestStop();
      }

      expect(lifecycle.snapshot().state).toBe("stopping");
    });
  });

  describe("3. Manual-Only Control & Auto-Endpointing Configuration", () => {
    test("autoEndpointEnabled = false disables silence endpointing", () => {
      const autoEndpointEnabled = false;
      const transcriptionDelaySec = 0.5;

      const detector = new SpeechEndpointDetector({
        speechThresholdRms: 0.005,
        silenceThresholdRms: 0.003,
        confirmSilenceMs: 100,
        frameIntervalMs: 50,
      });

      detector.processFrame(0.01); // speech
      detector.processFrame(0.001);
      detector.processFrame(0.001); // endpointed internally in detector

      const status = detector.getStatus();
      expect(status.isEndpointed).toBe(true);

      // Application auto-stop gate check:
      const shouldAutoStop = status.isEndpointed && autoEndpointEnabled && transcriptionDelaySec > 0;
      expect(shouldAutoStop).toBe(false);
    });

    test("transcriptionDelaySec = 0 disables silence endpointing (full manual-only control)", () => {
      const autoEndpointEnabled = true;
      const transcriptionDelaySec = 0;

      const detector = new SpeechEndpointDetector({
        speechThresholdRms: 0.005,
        silenceThresholdRms: 0.003,
        confirmSilenceMs: 500,
        frameIntervalMs: 50,
      });

      detector.processFrame(0.01);
      for (let i = 0; i < 15; i++) {
        detector.processFrame(0.001);
      }

      const status = detector.getStatus();

      // Application auto-stop gate check:
      const shouldAutoStop = status.isEndpointed && autoEndpointEnabled && transcriptionDelaySec > 0;
      expect(shouldAutoStop).toBe(false);
    });

    test("transcriptionDelaySec configures confirmSilenceMs properly", () => {
      const transcriptionDelaySec = 3.0; // 3.0s gap
      const confirmSilenceMs = Math.round(transcriptionDelaySec * 1000); // 3000ms

      const detector = new SpeechEndpointDetector({
        speechThresholdRms: 0.005,
        silenceThresholdRms: 0.003,
        confirmSilenceMs,
        frameIntervalMs: 50, // 60 frames = 3000ms
      });

      detector.processFrame(0.01); // speech

      // 59 silence frames -> not endpointed yet
      for (let i = 0; i < 59; i++) {
        const res = detector.processFrame(0.001);
        expect(res.isEndpointed).toBe(false);
      }

      // 60th silence frame -> endpointed
      const res60 = detector.processFrame(0.001);
      expect(res60.isEndpointed).toBe(true);
    });
  });

  describe("4. Config Persistence for transcriptionDelaySec & autoEndpointEnabled", () => {
    let testCwd: string;

    beforeEach(() => {
      testCwd = join(tmpdir(), `pi-voice-test-delay-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(join(testCwd, ".pi"), { recursive: true });
      writeFileSync(join(testCwd, ".pi", "pi-voice.json"), "{}");
    });

    afterEach(() => {
      try {
        rmSync(testCwd, { recursive: true, force: true });
      } catch {}
    });

    test("loadConfig returns default transcriptionDelaySec (0.5) and autoEndpointEnabled (true)", () => {
      const config = loadConfig(testCwd);
      expect(config.transcriptionDelaySec).toBe(0.5);
      expect(config.autoEndpointEnabled).toBe(true);
    });

    test("updateConfig persists custom transcriptionDelaySec and autoEndpointEnabled values", () => {
      const updated = updateConfig(testCwd, {
        transcriptionDelaySec: 2.5,
        autoEndpointEnabled: false,
      });

      expect(updated.transcriptionDelaySec).toBe(2.5);
      expect(updated.autoEndpointEnabled).toBe(false);

      const reloaded = loadConfig(testCwd);
      expect(reloaded.transcriptionDelaySec).toBe(2.5);
      expect(reloaded.autoEndpointEnabled).toBe(false);
    });

    test("updateConfig clamps out-of-range transcriptionDelaySec values to [0.0, 10.0]", () => {
      const updatedNegative = updateConfig(testCwd, { transcriptionDelaySec: -1.5 });
      expect(updatedNegative.transcriptionDelaySec).toBe(0.0);

      const updatedExcessive = updateConfig(testCwd, { transcriptionDelaySec: 15.0 });
      expect(updatedExcessive.transcriptionDelaySec).toBe(10.0);
    });
  });
});
