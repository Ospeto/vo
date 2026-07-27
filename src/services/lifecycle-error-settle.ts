import type { RecordingLifecycle } from "./recording-lifecycle.js";

/** Settles only the error that belongs to the sequence that scheduled the timer. */
export function settleMatchingLifecycleError(lifecycle: RecordingLifecycle, sequenceId: number): boolean {
  const snapshot = lifecycle.snapshot();
  if (snapshot.state !== "error" || snapshot.sequenceId !== sequenceId) return false;
  return lifecycle.settle().accepted;
}
