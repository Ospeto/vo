import type { RecordingLifecycle } from "./recording-lifecycle.js";

export type RecordingErrorPayload = { error?: unknown; sequenceId?: unknown };

export function createRecordingErrorPayload(error: string, sequenceId: number): RecordingErrorPayload {
  return { error, sequenceId };
}

export function handleRecordingError(
  payload: unknown,
  lifecycle: RecordingLifecycle,
  invalidate: () => void,
  restore: (sequenceId: number) => void,
  setError: (message: string) => void,
): boolean {
  if (!payload || typeof payload !== "object") return false;
  const { error, sequenceId } = payload as RecordingErrorPayload;
  if (typeof error !== "string" || !Number.isSafeInteger(sequenceId)) return false;
  const snapshot = lifecycle.snapshot();
  if (sequenceId !== snapshot.sequenceId || !["starting", "recording", "stopping"].includes(snapshot.state)) return false;
  invalidate();
  lifecycle.reset();
  restore(snapshot.sequenceId);
  setError(error);
  return true;
}
