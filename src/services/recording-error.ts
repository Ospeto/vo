import type { RecordingLifecycle } from "./recording-lifecycle.js";

export type RecordingErrorPayload = { error?: unknown; sequenceId?: unknown };

export function createRecordingErrorPayload(error: string, sequenceId: number): RecordingErrorPayload {
  return { error, sequenceId };
}

export function handleRecordingError(
  payload: RecordingErrorPayload,
  lifecycle: RecordingLifecycle,
  invalidate: () => void,
  restore: (sequenceId: number) => void,
  setError: (message: string) => void,
): boolean {
  if (typeof payload.error !== "string" || !Number.isSafeInteger(payload.sequenceId)) return false;
  const snapshot = lifecycle.snapshot();
  if (payload.sequenceId !== snapshot.sequenceId || !["starting", "recording", "stopping"].includes(snapshot.state)) return false;
  invalidate();
  lifecycle.reset();
  restore(snapshot.sequenceId);
  setError(payload.error);
  return true;
}
