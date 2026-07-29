export const MINIMUM_HOLD_RECORDING_MS = 800;

export function shouldEnsureMinimumDuration(pressDurationMs: number, recordingElapsedMs: number): boolean {
  return pressDurationMs < MINIMUM_HOLD_RECORDING_MS || recordingElapsedMs < MINIMUM_HOLD_RECORDING_MS;
}

export function isAutoEndpointEnabled(dictationMode: "hold" | "toggle", configured = true): boolean {
  return dictationMode !== "hold" && configured;
}
