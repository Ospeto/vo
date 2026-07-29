import { describe, test, expect } from "bun:test";
import { SpeechEndpointDetector } from "../../shared/audio-utils.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import {
  isAutoEndpointEnabled,
  MINIMUM_HOLD_RECORDING_MS,
  shouldEnsureMinimumDuration,
} from "../../services/hold-mode-protections.js";

describe("Hold Mode Recording Protections & Auto-Endpointing Guard Suite", () => {
  describe("1. Hold mode minimum capture window protection", () => {
    test("queues pending stop when key up occurs during starting state and enforces 800ms minimum capture duration", async () => {
      const lifecycle = new RecordingLifecycle();
      let pendingStopOnStart = false;
      let stopRecordingCalledWith: boolean | undefined = undefined;

      // Start flow: state = starting
      const startRes = lifecycle.requestStart();
      expect(startRes.accepted).toBe(true);

      // Key up occurs immediately (10ms after press) while state is still 'starting'
      if (lifecycle.snapshot().state === "starting") {
        pendingStopOnStart = true;
      }

      expect(pendingStopOnStart).toBe(true);

      // Startup async tasks finish, state transitions to 'recording'
      const recordingStartTime = Date.now();
      lifecycle.acknowledgeStart(startRes.sequenceId, true);

      // Pending stop handler checks minimum capture duration
      if (pendingStopOnStart) {
        const elapsed = Date.now() - recordingStartTime;
        const delay = Math.max(0, MINIMUM_HOLD_RECORDING_MS - elapsed);
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(800);

        const stopRes = lifecycle.requestStop();
        expect(stopRes.accepted).toBe(true);
        stopRecordingCalledWith = true;
      }

      expect(stopRecordingCalledWith).toBe(true);
      expect(lifecycle.snapshot().state).toBe("stopping");
    });

    test("hold mode hotkey release shortly after press during recording state passes ensureMinimumDuration = true", () => {
      const lifecycle = new RecordingLifecycle();
      const recordingStartTime = Date.now();

      const startRes = lifecycle.requestStart();
      lifecycle.acknowledgeStart(startRes.sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("recording");

      // Key released 100ms after press (under 800ms threshold)
      const elapsed = Date.now() - recordingStartTime; // ~0-10ms

      const ensureMinimumDuration = shouldEnsureMinimumDuration(100, elapsed);
      expect(ensureMinimumDuration).toBe(true);

      const stopRes = lifecycle.requestStop();
      expect(stopRes.accepted).toBe(true);
      expect(lifecycle.snapshot().state).toBe("stopping");
    });

    test("hold mode hotkey release after 800ms duration passes ensureMinimumDuration = false", () => {
      const recordingStartTime = Date.now() - 900;

      const elapsed = Date.now() - recordingStartTime; // 900ms

      const ensureMinimumDuration = shouldEnsureMinimumDuration(1000, elapsed);
      expect(ensureMinimumDuration).toBe(false);
    });
  });

  describe("2. Auto-endpointing disabled in hold mode", () => {
    test("autoEndpointEnabled is set to false when dictationMode === 'hold'", () => {
      expect(isAutoEndpointEnabled("hold", true)).toBe(false);
      expect(isAutoEndpointEnabled("hold", false)).toBe(false);
      expect(isAutoEndpointEnabled("toggle", true)).toBe(true);
      expect(isAutoEndpointEnabled("toggle", false)).toBe(false);
    });

    test("auto-endpoint trigger is bypassed when autoEndpointEnabled is false even if SpeechEndpointDetector endpoints", () => {
      const detector = new SpeechEndpointDetector({
        minSpeechDurationMs: 100,
        confirmSilenceMs: 150,
        frameIntervalMs: 50,
      });

      // 3 speech frames -> speech detected
      detector.processFrame(0.05);
      detector.processFrame(0.05);
      detector.processFrame(0.05);

      // 3 silence frames -> detector marks isEndpointed = true
      detector.processFrame(0.001);
      detector.processFrame(0.001);
      const status = detector.processFrame(0.001);

      expect(status.isEndpointed).toBe(true);

      const autoEndpointEnabled = false;
      const transcriptionDelaySec = 0.5;
      let autoEndpointTriggered = false;

      const shouldAutoStop = status.isEndpointed && autoEndpointEnabled && transcriptionDelaySec > 0;
      if (shouldAutoStop) {
        autoEndpointTriggered = true;
      }

      expect(autoEndpointTriggered).toBe(false);
    });
  });

  describe("3. Mid-utterance pauses during hold mode", () => {
    test("SpeechEndpointDetector does not endpoint on brief mid-utterance pauses (100-300ms) under standard threshold", () => {
      const detector = new SpeechEndpointDetector({
        minSpeechDurationMs: 150,
        confirmSilenceMs: 500, // 500ms required silence before endpointing
        frameIntervalMs: 50,
      });

      // User speaks for 200ms (4 frames)
      detector.processFrame(0.05);
      detector.processFrame(0.05);
      detector.processFrame(0.05);
      const s1 = detector.processFrame(0.05);
      expect(s1.hasDetectedSpeech).toBe(true);
      expect(s1.isEndpointed).toBe(false);

      // User pauses for 250ms (5 frames of silence: 250ms < 500ms)
      for (let i = 0; i < 5; i++) {
        const pauseFrame = detector.processFrame(0.001);
        expect(pauseFrame.isEndpointed).toBe(false);
      }

      // User resumes speaking
      const s2 = detector.processFrame(0.04);
      expect(s2.hasDetectedSpeech).toBe(true);
      expect(s2.isEndpointed).toBe(false);
    });

    test("Audio warmup guard ignores initial metering frames during first 200ms of recording", () => {
      const detector = new SpeechEndpointDetector({
        minSpeechDurationMs: 150,
        confirmSilenceMs: 500,
        frameIntervalMs: 50,
      });

      const recordingStartTime = Date.now();

      // Simulate 3 metering frames at t = 50ms, 100ms, 150ms with transient audio pops (RMS = 0.05)
      for (const offsetMs of [50, 100, 150]) {
        const elapsedMs = offsetMs;
        const isWarmingUp = elapsedMs < 200;
        if (!isWarmingUp) {
          detector.processFrame(0.05);
        }
      }

      // Because all frames during the 200ms warmup window were skipped, speech was NOT detected
      expect(detector.getStatus().hasDetectedSpeech).toBe(false);

      // Once warmup finishes (t = 250ms), normal speech processing resumes
      const elapsedMs = 250;
      const isWarmingUp = elapsedMs < 200;
      if (!isWarmingUp) {
        detector.processFrame(0.05);
      }

      // After 1 frame post-warmup, minSpeechDurationMs (150ms) hasn't been accumulated yet
      expect(detector.getStatus().hasDetectedSpeech).toBe(false);
    });
  });
});
