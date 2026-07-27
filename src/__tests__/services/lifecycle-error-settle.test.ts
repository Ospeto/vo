import { describe, expect, test } from "bun:test";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { settleMatchingLifecycleError } from "../../services/lifecycle-error-settle.js";

describe("settleMatchingLifecycleError", () => {
  test("does not settle a later lifecycle for an old error sequence", () => {
    const lifecycle = new RecordingLifecycle();
    const first = lifecycle.requestStart();
    lifecycle.acknowledgeStart(first.sequenceId, false);
    lifecycle.reset();
    const second = lifecycle.requestStart();

    expect(settleMatchingLifecycleError(lifecycle, first.sequenceId)).toBe(false);
    expect(lifecycle.snapshot()).toEqual({ state: "starting", sequenceId: second.sequenceId });
  });

  test("settles the matching error sequence", () => {
    const lifecycle = new RecordingLifecycle();
    const start = lifecycle.requestStart();
    lifecycle.acknowledgeStart(start.sequenceId, false);

    expect(settleMatchingLifecycleError(lifecycle, start.sequenceId)).toBe(true);
    expect(lifecycle.snapshot().state).toBe("idle");
  });
});
