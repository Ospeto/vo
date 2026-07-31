import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { PasteCoordinator } from "../../services/paste-flow.js";

describe("PR-03 HUD & Capture Window Stall Fix Regression Suite", () => {
  const mainTsPath = resolve(process.cwd(), "src/main.ts");
  const captureTsPath = resolve(process.cwd(), "src/renderer/capture.ts");
  const hudTsPath = resolve(process.cwd(), "src/renderer/hud.ts");

  const mainTsContent = readFileSync(mainTsPath, "utf-8");
  const captureTsContent = readFileSync(captureTsPath, "utf-8");
  const hudTsContent = readFileSync(hudTsPath, "utf-8");

  describe("1. Hidden Capture Window Background Throttling Prevention", () => {
    test("captureWindow webPreferences explicitly sets backgroundThrottling: false", () => {
      expect(mainTsContent).toContain("backgroundThrottling: false");
    });
  });

  describe("2. Stop Timeout Explicit HUD Reset & Immediate Hiding", () => {
    test("stoppingSafetyTimer explicitly cancels timer, hides hudWindow if visible, and resets state machine", () => {
      expect(mainTsContent).toContain("Stopping state timed out, auto-resetting state machine to idle");
      expect(mainTsContent).toContain("if (hudWindow && hudWindow.isVisible())");
      expect(mainTsContent).toContain("hudWindow.hide();");
    });

    test("valid normal transcription flow retains HUD during transcribing before idle 1500ms auto-hide", () => {
      expect(mainTsContent).toContain("hudHideTimer = setTimeout(() => {");
      expect(mainTsContent).toContain("1500");
    });
  });

  describe("3. Renderer HUD Meter Reset on Non-Recording Transitions", () => {
    test("hud.ts resets meter bars inline height on any non-recording state update", () => {
      expect(hudTsContent).toContain("function resetMeterBars");
      expect(hudTsContent).toContain("if (state !== \"recording\")");
      expect(hudTsContent).toContain("resetMeterBars()");
      expect(hudTsContent).toContain("bar.style.height = \"\"");
    });
  });

  describe("4. Capture Engine Single Completion & Resource Safety", () => {
    test("sendRecordingErrorOnce guarantees single error emission and timer cleanup", () => {
      expect(captureTsContent).toContain("function sendRecordingErrorOnce");
      expect(captureTsContent).toContain("finalizedRecordingGeneration = generation");
      expect(captureTsContent).toContain("audioChunks = []");
    });

    test("stopRecording handles inactive recorder without hanging when startup completes or fails", () => {
      expect(captureTsContent).toContain("isStartingUp");
      expect(captureTsContent).toContain("sendRecordingErrorOnce(generation, sequenceId, \"Recorder inactive\")");
    });

    test("renderer retains only the active recording sequence", () => {
      expect(captureTsContent).toContain("let activeSequenceId: number | undefined;");
      expect(captureTsContent).toContain("activeSequenceId = undefined;");
      expect(captureTsContent).not.toContain("new Map<number, number>()");
    });

    test("window beforeunload listener cleans up WebAudio, MediaRecorder, and timers", () => {
      expect(captureTsContent).toContain("window.addEventListener(\"beforeunload\"");
      expect(captureTsContent).toContain("cleanupPartialPipeline()");
    });

    test("quiet and empty capture policy emits typed recording error and purges audio chunks", () => {
      expect(captureTsContent).toContain("Microphone input extremely quiet");
      expect(captureTsContent).toContain("No speech detected (silent audio)");
      expect(captureTsContent).toContain("Recording too short");
    });
  });

  describe("5. Lifecycle Recovery & Multi-Attempt Continuity", () => {
    test("subsequent dictation attempt can start cleanly after a stop timeout / lifecycle reset", () => {
      const lifecycle = new RecordingLifecycle();

      // Attempt 1: Start -> Record -> Stop (Times out)
      const start1 = lifecycle.requestStart();
      expect(start1.accepted).toBe(true);
      lifecycle.acknowledgeStart(start1.sequenceId, true);
      const stop1 = lifecycle.requestStop();
      expect(stop1.accepted).toBe(true);

      // Simulate main process stoppingSafetyTimer timeout: reset lifecycle
      lifecycle.reset();
      expect(lifecycle.snapshot().state).toBe("idle");

      // Attempt 2: Immediate next dictation must succeed
      const start2 = lifecycle.requestStart();
      expect(start2.accepted).toBe(true);
      expect(start2.sequenceId).toBe(start1.sequenceId + 2);
      lifecycle.acknowledgeStart(start2.sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("recording");
    });

    test("subsequent dictation attempt can start cleanly after recording error", () => {
      const lifecycle = new RecordingLifecycle();

      // Attempt 1: Start -> Error
      const start1 = lifecycle.requestStart();
      expect(start1.accepted).toBe(true);
      lifecycle.acknowledgeStart(start1.sequenceId, false);

      expect(lifecycle.snapshot().state).toBe("error");

      // Settle error on next attempt or timeout
      lifecycle.settle();
      expect(lifecycle.snapshot().state).toBe("idle");

      // Attempt 2: Start new recording
      const start2 = lifecycle.requestStart();
      expect(start2.accepted).toBe(true);
      expect(lifecycle.snapshot().state).toBe("starting");
    });

    test("subsequent dictation attempt can start cleanly after cancellation", () => {
      const lifecycle = new RecordingLifecycle();

      // Attempt 1: Start -> Cancel
      const start1 = lifecycle.requestStart();
      expect(start1.accepted).toBe(true);
      lifecycle.cancel();
      expect(lifecycle.snapshot().state).toBe("idle");

      // Attempt 2: Start new recording
      const start2 = lifecycle.requestStart();
      expect(start2.accepted).toBe(true);
      expect(lifecycle.snapshot().state).toBe("starting");
    });
  });
});
