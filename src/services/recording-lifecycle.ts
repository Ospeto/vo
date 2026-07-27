import type {
  RecordingLifecycleResult,
  RecordingLifecycleSnapshot,
  RecordingLifecycleState,
} from "../shared/types.js";

/** Pure state machine for one recording/transcription lifecycle. */
export class RecordingLifecycle {
  private state: RecordingLifecycleState = "idle";
  private sequenceId = 0;
  private shutdownRequested = false;

  snapshot(): RecordingLifecycleSnapshot {
    return { state: this.state, sequenceId: this.sequenceId };
  }

  requestToggle(): RecordingLifecycleResult {
    if (this.state === "idle") return this.requestStart();
    if (this.state === "recording") return this.requestStop();
    return this.reject("Recording is already in progress or unavailable.");
  }

  requestStart(): RecordingLifecycleResult {
    if (this.state !== "idle") return this.reject("Recording can only start from idle.");
    this.sequenceId += 1;
    this.state = "starting";
    this.shutdownRequested = false;
    return this.accept();
  }

  requestStop(): RecordingLifecycleResult {
    if (this.state !== "recording") return this.reject("Recording can only stop from recording.");
    this.state = "stopping";
    return this.accept();
  }

  acknowledgeStart(sequenceId: number, success: boolean): RecordingLifecycleResult {
    if (!this.matches(sequenceId, "starting")) return this.reject("Stale start acknowledgement.");
    this.state = success ? "recording" : "error";
    return this.accept();
  }

  acknowledgeStop(sequenceId: number, success: boolean): RecordingLifecycleResult {
    if (!this.matches(sequenceId, "stopping")) return this.reject("Stale stop acknowledgement.");
    this.state = success ? "transcribing" : "error";
    return this.accept();
  }

  finishTranscription(sequenceId: number, success: boolean): RecordingLifecycleResult {
    if (!this.matches(sequenceId, "transcribing")) {
      return this.reject("Stale transcription event.");
    }
    this.state = success ? "idle" : "error";
    return this.accept();
  }

  /** Recover an error or cancel any pending lifecycle, invalidating its events. */
  reset(): RecordingLifecycleResult {
    if (this.state === "idle") return this.reject("Lifecycle is already idle.");
    this.invalidate();
    this.shutdownRequested = false;
    return this.accept();
  }

  settle(): RecordingLifecycleResult {
    if (this.state !== "error") return this.reject("Only an error can be settled.");
    return this.reset();
  }

  /** Idempotently cancel pending work, preserving an error for explicit recovery. */
  shutdown(): RecordingLifecycleResult {
    if (this.shutdownRequested || this.state === "idle") {
      return this.reject("Lifecycle is already shut down.");
    }
    this.sequenceId += 1;
    if (this.state !== "error") this.state = "idle";
    this.shutdownRequested = true;
    return this.accept();
  }

  private invalidate(): void {
    this.sequenceId += 1;
    this.state = "idle";
  }

  private matches(sequenceId: number, expectedState: RecordingLifecycleState): boolean {
    return this.sequenceId === sequenceId && this.state === expectedState;
  }

  private accept(): RecordingLifecycleResult {
    return { ...this.snapshot(), accepted: true };
  }

  private reject(reason: string): RecordingLifecycleResult {
    return { ...this.snapshot(), accepted: false, reason };
  }
}
