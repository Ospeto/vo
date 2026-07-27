export interface RecordingFailureSender {
  sendRecordingError: (sequenceId: number, error: string) => void;
  sendRecordingStopResult: (sequenceId: number, success: boolean, error?: string) => void;
}

export function sendRecordingFailure(
  sender: RecordingFailureSender,
  sequenceId: number,
  error: string,
  runtime: boolean,
): void {
  if (runtime) sender.sendRecordingError(sequenceId, error);
  else sender.sendRecordingStopResult(sequenceId, false, error);
}
