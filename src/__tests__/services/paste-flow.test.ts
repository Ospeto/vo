import { describe, expect, test } from "bun:test";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

describe("PasteCoordinator", () => {
  test("awaits successful paste and resets mutex", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const coordinator = new PasteCoordinator(async () => { calls++; await pending; return { ok: true, reason: "injection_requested" }; });
    const first = coordinator.pasteText("hello");
    expect(await Promise.race([first.then(() => "done"), Promise.resolve("pending")])).toBe("pending");
    release();
    expect(await first).toEqual({ status: "submitted" });
    expect(await coordinator.pasteText("world")).toEqual({ status: "submitted" });
    expect(calls).toBe(2);
  });

  test("resets mutex after denial", async () => {
    const coordinator = new PasteCoordinator(async () => ({ ok: false, reason: "target_mismatch" }));
    expect(await coordinator.pasteText("world")).toEqual({ status: "denied", reason: "target_mismatch" });
    expect(await coordinator.pasteText("hello")).toEqual({ status: "denied", reason: "target_mismatch" });
  });

  test("resets mutex after an exception", async () => {
    let calls = 0;
    const coordinator = new PasteCoordinator(async () => { calls++; if (calls === 1) throw new Error("injection failed"); return { ok: true, reason: "injection_requested" }; });
    expect(await coordinator.pasteText("hello")).toEqual({ status: "error", reason: "injection failed" });
    expect(await coordinator.pasteText("world")).toEqual({ status: "submitted" });
  });

  test("blocks a second toggle while paste is pending", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = new PasteCoordinator(async () => { await pending; return { ok: true, reason: "injection_requested" }; });
    const first = coordinator.pasteText("hello");
    expect(await coordinator.pasteText("world")).toEqual({ status: "duplicate" });
    release();
    expect(await first).toEqual({ status: "submitted" });
  });

  test("ignores stale completion after lifecycle invalidation", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = new PasteCoordinator(async () => { await pending; return { ok: true, reason: "injection_requested" }; });
    const first = coordinator.pasteText("hello");
    coordinator.invalidate();
    release();
    expect(await first).toEqual({ status: "stale", reason: "Paste invalidated; transcript was retained" });
  });

  test("keeps transcription pending, rejects toggles, and suppresses stale completion effects", async () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();
    lifecycle.acknowledgeStart(start.sequenceId, true);
    const stop = lifecycle.requestStop();
    lifecycle.acknowledgeStop(stop.sequenceId, true);
    let release!: () => void;
    const coordinator = new PasteCoordinator(async () => new Promise((resolve) => {
      release = () => resolve({ ok: true, reason: "injection_requested" });
    }));
    const pending = coordinator.pasteText("hello");
    expect(lifecycle.snapshot().state).toBe("transcribing");
    expect(lifecycle.requestToggle().accepted).toBe(false);
    coordinator.invalidate();
    release();
    const result = await pending;
    expect(result.status).toBe("stale");
    expect(lifecycle.snapshot().state).toBe("transcribing");
  });

  test("dedupe text and timestamp commit on successful submission only", async () => {
    let returnSuccess = false;
    let calls = 0;
    const coordinator = new PasteCoordinator(async () => {
      calls++;
      if (returnSuccess) return { ok: true, reason: "injection_requested" };
      return { ok: false, reason: "target_mismatch" };
    });

    // 1. Denied attempt must NOT commit dedupe
    const res1 = await coordinator.pasteText("same text");
    expect(res1).toEqual({ status: "denied", reason: "target_mismatch" });
    expect(calls).toBe(1);

    // Immediate retry with same text must NOT be suppressed as duplicate
    const res2 = await coordinator.pasteText("same text");
    expect(res2).toEqual({ status: "denied", reason: "target_mismatch" });
    expect(calls).toBe(2);

    // 2. Successful attempt MUST commit dedupe
    returnSuccess = true;
    const res3 = await coordinator.pasteText("same text");
    expect(res3).toEqual({ status: "submitted" });
    expect(calls).toBe(3);

    // Immediate retry with same text MUST be suppressed as duplicate
    const res4 = await coordinator.pasteText("same text");
    expect(res4).toEqual({ status: "duplicate" });
    expect(calls).toBe(3);
  });

  test("accepts recording lifecycle sequence and predicate without minting validity at call time", async () => {
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

    // Invalidate recording lifecycle (e.g. user pressed Escape / cancelled)
    lifecycle.cancel();

    // Calling pasteText with old sequence and predicate must refuse immediately without minting validity
    const res = await coordinator.pasteText("text", currentSeq, isCurrentTranscription);
    expect(res).toEqual({ status: "stale", reason: "Paste invalidated; transcript was retained" });
    expect(pasteCalled).toBe(false);
  });
});
