export const MINIMUM_HOLD_RECORDING_MS = 800;
export const SHORT_TAP_HOLD_RECORDING_MS = 2500;
export const SHORT_TAP_THRESHOLD_MS = 250;

export function shouldEnsureMinimumDuration(pressDurationMs: number, recordingElapsedMs: number): boolean {
  return pressDurationMs < MINIMUM_HOLD_RECORDING_MS || recordingElapsedMs < MINIMUM_HOLD_RECORDING_MS;
}

export function getHoldModeMinimumDuration(pressDurationMs: number, isFnDown = false): number {
  if (pressDurationMs < SHORT_TAP_THRESHOLD_MS && !isFnDown) {
    return SHORT_TAP_HOLD_RECORDING_MS;
  }
  return MINIMUM_HOLD_RECORDING_MS;
}

export function isAutoEndpointEnabled(_dictationMode: "hold" | "toggle", _configured = true): boolean {
  return false;
}
