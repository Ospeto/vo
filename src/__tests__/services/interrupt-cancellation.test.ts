import { describe, expect, test } from "bun:test";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { transcribeDetailed } from "../../services/stt.js";

describe("Interrupt and Cancellation Test Suite", () => {
  describe("1. RecordingLifecycle Cancellation Contracts", () => {
    test("cancel() resets state from starting to idle and invalidates sequence ID", () => {
      const lifecycle = new RecordingLifecycle();
      const start = lifecycle.requestStart();
      expect(start).toMatchObject({ accepted: true, state: "starting", sequenceId: 1 });

      const cancelRes = lifecycle.cancel();
      expect(cancelRes).toMatchObject({ accepted: true, state: "idle" });

      // Late acknowledgement with old sequence ID must be rejected
      const lateAck = lifecycle.acknowledgeStart(start.sequenceId, true);
      expect(lateAck.accepted).toBe(false);
      expect(lifecycle.snapshot().state).toBe("idle");
    });

    test("cancel() resets state from recording to idle and invalidates sequence ID", () => {
      const lifecycle = new RecordingLifecycle();
      const start = lifecycle.requestStart();
      lifecycle.acknowledgeStart(start.sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("recording");

      const cancelRes = lifecycle.cancel();
      expect(cancelRes).toMatchObject({ accepted: true, state: "idle" });

      // Late stop request or acknowledgement with old sequence ID must be rejected
      const stopRes = lifecycle.acknowledgeStop(start.sequenceId, true);
      expect(stopRes.accepted).toBe(false);
      expect(lifecycle.snapshot().state).toBe("idle");
    });

    test("cancel() resets state from transcribing to idle and invalidates late transcription completion", () => {
      const lifecycle = new RecordingLifecycle();
      const start = lifecycle.requestStart();
      lifecycle.acknowledgeStart(start.sequenceId, true);
      const stop = lifecycle.requestStop();
      lifecycle.acknowledgeStop(stop.sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("transcribing");

      const cancelRes = lifecycle.cancel();
      expect(cancelRes).toMatchObject({ accepted: true, state: "idle" });

      // Late transcription result from old sequence ID must be rejected
      const lateFinish = lifecycle.finishTranscription(stop.sequenceId, true);
      expect(lateFinish.accepted).toBe(false);
      expect(lifecycle.snapshot().state).toBe("idle");
    });

    test("cancel() returns rejected result if lifecycle is already idle", () => {
      const lifecycle = new RecordingLifecycle();
      expect(lifecycle.snapshot().state).toBe("idle");

      const cancelRes = lifecycle.cancel();
      expect(cancelRes).toMatchObject({ accepted: false, reason: "Lifecycle is already idle." });
    });
  });

  describe("2. STT AbortSignal Cancellation Contracts", () => {
    test("transcribeDetailed fails fast when passed an already-aborted AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      const fakeAudio = new ArrayBuffer(2000);
      expect(
        transcribeDetailed(fakeAudio, {
          provider: "gemini",
          abortSignal: controller.signal,
        })
      ).rejects.toThrow("Transcription aborted");
    });

    test("transcribeDetailed aborts in-flight request when AbortSignal is triggered", async () => {
      const controller = new AbortController();
      const fakeAudio = new ArrayBuffer(2000);

      const promise = transcribeDetailed(fakeAudio, {
        provider: "gemini",
        abortSignal: controller.signal,
      });

      // Abort while request is pending
      controller.abort();

      expect(promise).rejects.toThrow();
    });
  });

  describe("3. PasteCoordinator Cancellation & Invalidation Contracts", () => {
    test("PasteCoordinator.invalidate() prevents pending paste from completing", async () => {
      let pasteExecuted = false;
      const coordinator = new PasteCoordinator(async (text, isCurrent) => {
        await new Promise((r) => setTimeout(r, 50));
        if (!isCurrent()) {
          return { ok: false, reason: "target_mismatch" };
        }
        pasteExecuted = true;
        return { ok: true, reason: "injection_requested" };
      });

      const pastePromise = coordinator.pasteText("Test cancellation transcript");

      // Invalidate while paste operation is in-flight
      coordinator.invalidate();

      const result = await pastePromise;
      expect(result.status).toBe("stale");
      expect(pasteExecuted).toBe(false);
    });
  });

  describe("4. Integration Flow: Interrupt during Recording and Transcribing", () => {
    test("cancelling during transcribing resets state, invalidates in-flight paste, and rejects stale transcription result", async () => {
      const lifecycle = new RecordingLifecycle();
      let isPasted = false;
      const coordinator = new PasteCoordinator(async (text, isCurrent) => {
        await new Promise((r) => setTimeout(r, 20));
        if (!isCurrent()) return { ok: false, reason: "target_mismatch" };
        isPasted = true;
        return { ok: true, reason: "injection_requested" };
      });

      // 1. Start and stop recording -> enter transcribing
      const start = lifecycle.requestStart();
      lifecycle.acknowledgeStart(start.sequenceId, true);
      const stop = lifecycle.requestStop();
      lifecycle.acknowledgeStop(stop.sequenceId, true);
      expect(lifecycle.snapshot()).toMatchObject({ state: "transcribing", sequenceId: start.sequenceId });

      // 2. Initiate in-flight paste operation
      const inFlightPaste = coordinator.pasteText("Pending transcription result");

      // 3. Trigger interrupt/cancel while transcribing/pasting
      lifecycle.cancel();
      coordinator.invalidate();

      expect(lifecycle.snapshot().state).toBe("idle");

      // 4. Late transcription finish attempt -> must be rejected
      const finish = lifecycle.finishTranscription(start.sequenceId, true);
      expect(finish.accepted).toBe(false);

      // 5. In-flight paste -> must be aborted as stale
      const pasteRes = await inFlightPaste;
      expect(pasteRes.status).toBe("stale");
      expect(isPasted).toBe(false);
    });

    test("main orchestration with delayed getActiveAppName discards stale paste when cancelled during lookup", async () => {
      const lifecycle = new RecordingLifecycle();
      const start = lifecycle.requestStart();
      lifecycle.acknowledgeStart(start.sequenceId, true);
      const stop = lifecycle.requestStop();
      lifecycle.acknowledgeStop(stop.sequenceId, true);

      const currentSeq = start.sequenceId;
      const isCurrentTranscription = (seq: number) =>
        lifecycle.snapshot().sequenceId === seq && lifecycle.snapshot().state === "transcribing";

      let pasteCalled = false;
      const coordinator = new PasteCoordinator(async () => {
        pasteCalled = true;
        return { ok: true, reason: "injection_requested" };
      });

      // Controllable delayed active-app lookup
      let resolveActiveApp!: (appName: string) => void;
      const pendingActiveApp = new Promise<string>((r) => { resolveActiveApp = r; });
      const getActiveAppName = () => pendingActiveApp;

      // Start orchestration task
      let orchestrationFinished = false;
      let pasteResult: any = null;

      const runOrchestration = (async () => {
        const text = "Dictated text";
        const activeApp = await getActiveAppName();

        // Recheck 1: immediately after active-app lookup
        if (!isCurrentTranscription(currentSeq)) {
          orchestrationFinished = true;
          return { status: "stale_lookup" };
        }

        // Recheck 2: immediately before calling coordinator
        if (!isCurrentTranscription(currentSeq)) {
          orchestrationFinished = true;
          return { status: "stale_before_coordinator" };
        }

        pasteResult = await coordinator.pasteText(text, currentSeq, isCurrentTranscription);

        if (!isCurrentTranscription(currentSeq) || pasteResult.status === "stale") {
          orchestrationFinished = true;
          return { status: "stale_result" };
        }

        orchestrationFinished = true;
        return pasteResult;
      })();

      // While getActiveAppName is pending, cancel dictation (e.g. Escape key pressed)
      lifecycle.cancel();
      coordinator.invalidate();

      // Resolve getActiveAppName now
      resolveActiveApp("Editor");

      const outcome = await runOrchestration;
      expect(outcome).toEqual({ status: "stale_lookup" });
      expect(pasteCalled).toBe(false);
      expect(orchestrationFinished).toBe(true);
      expect(lifecycle.snapshot().state).toBe("idle");
    });
  });
});
