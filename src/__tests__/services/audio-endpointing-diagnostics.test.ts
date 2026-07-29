import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  analyzePcmFrame,
  SpeechEndpointDetector,
  diagnoseAudioStats,
  type AudioRecordingStats,
} from "../../shared/audio-utils.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

describe("Audio Capture Diagnostics & Endpointing Regression Suite", () => {
  let lifecycle: RecordingLifecycle;

  beforeEach(() => {
    lifecycle = new RecordingLifecycle();
  });

  describe("1. Utterance Boundary & Silence Endpointing", () => {
    test("detects speech start and triggers endpointing after confirmed silence threshold", () => {
      const detector = new SpeechEndpointDetector({
        speechThresholdRms: 0.01,
        silenceThresholdRms: 0.003,
        minSpeechDurationMs: 150,
        confirmSilenceMs: 400,
        frameIntervalMs: 50,
      });

      // Frame interval 50ms. 3 speech frames = 150ms speech duration
      const f1 = detector.processFrame(0.02);
      const f2 = detector.processFrame(0.03);
      const f3 = detector.processFrame(0.025);

      expect(f3.hasDetectedSpeech).toBe(true);
      expect(f3.isEndpointed).toBe(false);

      // Silence threshold 0.003. 8 frames = 400ms confirmed silence
      for (let i = 0; i < 7; i++) {
        const sf = detector.processFrame(0.001);
        expect(sf.isEndpointed).toBe(false);
      }

      const finalFrame = detector.processFrame(0.001);
      expect(finalFrame.isEndpointed).toBe(true);
      expect(finalFrame.hasDetectedSpeech).toBe(true);
    });

    test("does not trigger endpointing if speech was never detected (initial room silence)", () => {
      const detector = new SpeechEndpointDetector({
        confirmSilenceMs: 200,
        frameIntervalMs: 50,
      });

      // 20 initial silent frames (1000ms room silence) before user speaks
      for (let i = 0; i < 20; i++) {
        const sf = detector.processFrame(0.001);
        expect(sf.hasDetectedSpeech).toBe(false);
        expect(sf.isEndpointed).toBe(false);
      }
    });

    test("resets speech and silence counters cleanly between recording generations", () => {
      const detector = new SpeechEndpointDetector({
        minSpeechDurationMs: 50,
        confirmSilenceMs: 100,
        frameIntervalMs: 50,
      });

      detector.processFrame(0.05); // speech
      detector.processFrame(0.001);
      detector.processFrame(0.001); // endpointed!
      expect(detector.getStatus().isEndpointed).toBe(true);

      detector.reset();
      const status = detector.getStatus();
      expect(status.hasDetectedSpeech).toBe(false);
      expect(status.isEndpointed).toBe(false);
      expect(status.consecutiveSilenceFrames).toBe(0);
      expect(status.speechFrameCount).toBe(0);
    });
  });

  describe("2. Quality Diagnostics & Input Rejection", () => {
    test("diagnoses near-silence input and rejects garbage audio submission", () => {
      const stats: AudioRecordingStats = {
        durationMs: 2000,
        maxRms: 0.0005,
        peakAmplitude: 0.0008,
        speechFrames: 0,
        totalFrames: 40,
        clippingFrames: 0,
        hasSpeech: false,
      };

      const result = diagnoseAudioStats(stats);
      expect(result.status).toBe("near_silence");
      expect(result.message).toBe("No speech detected (silent audio)");
    });

    test("diagnoses short utterances (<300ms) without submitting to STT", () => {
      const stats: AudioRecordingStats = {
        durationMs: 200,
        maxRms: 0.05,
        peakAmplitude: 0.08,
        speechFrames: 4,
        totalFrames: 4,
        clippingFrames: 0,
        hasSpeech: true,
      };

      const result = diagnoseAudioStats(stats);
      expect(result.status).toBe("too_short");
      expect(result.message).toBe("Recording too short");
    });

    test("diagnoses severely clipped microphone input (>40% clipped frames)", () => {
      const stats: AudioRecordingStats = {
        durationMs: 1500,
        maxRms: 0.99,
        peakAmplitude: 1.0,
        speechFrames: 30,
        totalFrames: 30,
        clippingFrames: 15, // 50% clipped
        hasSpeech: true,
      };

      const result = diagnoseAudioStats(stats);
      expect(result.status).toBe("clipped");
      expect(result.message).toBe("Microphone input clipped or distorted");
    });

    test("approves valid speech audio with proper duration and level", () => {
      const stats: AudioRecordingStats = {
        durationMs: 1800,
        maxRms: 0.12,
        peakAmplitude: 0.25,
        speechFrames: 25,
        totalFrames: 36,
        clippingFrames: 0,
        hasSpeech: true,
      };

      const result = diagnoseAudioStats(stats);
      expect(result.status).toBe("valid_speech");
    });
  });

  describe("3. Immediate Cancellation & Sequence Safety", () => {
    test("cancellation during starting state invalidates lifecycle and prevents stale start completion", () => {
      const startRes = lifecycle.requestStart();
      expect(startRes.accepted).toBe(true);
      const startingSeq = startRes.sequenceId;

      // Cancel while still starting
      const cancelRes = lifecycle.cancel();
      expect(cancelRes.accepted).toBe(true);

      // Late acknowledgeStart from old starting sequence must be rejected
      const ackRes = lifecycle.acknowledgeStart(startingSeq, true);
      expect(ackRes.accepted).toBe(false);
      if (!ackRes.accepted) {
        expect(ackRes.reason).toContain("Stale");
      }
    });

    test("cancellation during recording resets state machine to idle and invalidates sequence ID", () => {
      const startRes = lifecycle.requestStart();
      lifecycle.acknowledgeStart(startRes.sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("recording");

      const cancelRes = lifecycle.cancel();
      expect(cancelRes.accepted).toBe(true);
      expect(lifecycle.snapshot().state).toBe("idle");

      // Stop request for cancelled sequence must be rejected
      const stopRes = lifecycle.requestStop();
      expect(stopRes.accepted).toBe(false);
    });

    test("cancellation during transcribing invalidates late STT completion", () => {
      const startRes = lifecycle.requestStart();
      lifecycle.acknowledgeStart(startRes.sequenceId, true);
      const stopRes = lifecycle.requestStop();
      lifecycle.acknowledgeStop(startRes.sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("transcribing");

      const transcribingSeq = startRes.sequenceId;

      // User cancels dictation during STT API call
      lifecycle.cancel();
      expect(lifecycle.snapshot().state).toBe("idle");

      // STT completion callback returning late must be rejected
      const finishRes = lifecycle.finishTranscription(transcribingSeq, true);
      expect(finishRes.accepted).toBe(false);
      if (!finishRes.accepted) {
        expect(finishRes.reason).toContain("Stale");
      }
    });
  });
});
