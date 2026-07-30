import type { DictationMode, RecordingLifecycleResult, RecordingLifecycleSnapshot } from "../shared/types.js";
import { RecordingLifecycle } from "./recording-lifecycle.js";
import { getHoldModeMinimumDuration, shouldEnsureMinimumDuration, SHORT_TAP_THRESHOLD_MS } from "./hold-mode-protections.js";

export type DictationTriggerMode = "dictate" | "edit";

export interface DictationControlCoordinatorOptions {
  dictationMode: DictationMode;
  isNativeKeyUpAvailable: () => boolean;
  isFnDown?: () => boolean;
  onStartRecording: (mode: DictationTriggerMode) => Promise<boolean> | boolean;
  onStopRecording: (ensureMinimumDuration: boolean) => Promise<boolean> | boolean;
  onCancelDictation: (reason: string) => void;
  playStopChime?: () => void;
}

export interface CoordinatorActionResult {
  accepted: boolean;
  action?: "started" | "queued_stop" | "stopped" | "cancelled" | "ignored" | "rejected";
  reason?: string;
  errorCode?: string;
}

/**
 * Production coordinator managing physical hold edges, explicit UI commands,
 * and deterministic toggle startup-stop transitions.
 */
export class DictationControlCoordinator {
  private lifecycle: RecordingLifecycle;
  private mode: DictationMode;
  private isNativeKeyUpAvailableFn: () => boolean;
  private isFnDownFn: () => boolean;
  private onStartRecordingFn: (mode: DictationTriggerMode) => Promise<boolean> | boolean;
  private onStopRecordingFn: (ensureMinimumDuration: boolean) => Promise<boolean> | boolean;
  private onCancelDictationFn: (reason: string) => void;
  private playStopChimeFn?: () => void;

  private pendingStopOrigin: "physical" | "explicit" | null = null;
  private keyHoldPressStartTime = 0;
  private lastHoldPressDuration = 0;
  private recordingStartTime = 0;
  private currentTriggerMode: DictationTriggerMode = "dictate";
  private shortTapTimer: any = null;

  constructor(options: DictationControlCoordinatorOptions, lifecycle?: RecordingLifecycle) {
    this.mode = options.dictationMode;
    this.isNativeKeyUpAvailableFn = options.isNativeKeyUpAvailable;
    this.isFnDownFn = options.isFnDown ?? (() => false);
    this.onStartRecordingFn = options.onStartRecording;
    this.onStopRecordingFn = options.onStopRecording;
    this.onCancelDictationFn = options.onCancelDictation;
    this.playStopChimeFn = options.playStopChime;
    this.lifecycle = lifecycle ?? new RecordingLifecycle();
  }

  public getLifecycle(): RecordingLifecycle {
    return this.lifecycle;
  }

  public snapshot(): RecordingLifecycleSnapshot {
    return this.lifecycle.snapshot();
  }

  public setDictationMode(mode: DictationMode): void {
    this.mode = mode;
  }

  public getDictationMode(): DictationMode {
    return this.mode;
  }

  public isPendingStop(): boolean {
    return this.pendingStopOrigin !== null;
  }

  public clearPendingStop(): void {
    this.pendingStopOrigin = null;
  }

  /** Physical key-down handler from FnHook */
  public async handlePhysicalDown(triggerMode: DictationTriggerMode = "dictate"): Promise<CoordinatorActionResult> {
    const now = Date.now();
    this.keyHoldPressStartTime = now;
    this.currentTriggerMode = triggerMode;

    if (this.mode === "hold") {
      if (!this.isNativeKeyUpAvailableFn()) {
        return {
          accepted: false,
          action: "rejected",
          reason: "Accessibility/Input Monitoring permissions required for Hold Mode. Please grant access in System Preferences > Privacy & Security > Accessibility or switch to Toggle Mode.",
          errorCode: "INPUT_MONITORING_REQUIRED",
        };
      }
      const state = this.lifecycle.snapshot().state;
      if (state === "idle" || state === "error") {
        return this.startRecording(triggerMode);
      }
      if (state === "transcribing" || state === "stopping" || state === "starting") {
        this.onCancelDictationFn("Cancelled via hotkey");
        return { accepted: true, action: "cancelled", reason: "Hotkey down during active state cancelled dictation" };
      }
      return { accepted: false, action: "ignored", reason: "Already recording" };
    } else {
      return this.handleToggleCommand("physical", triggerMode);
    }
  }

  /** Physical key-up handler from FnHook */
  public async handlePhysicalUp(): Promise<CoordinatorActionResult> {
    if (this.mode !== "hold") {
      return { accepted: true, action: "ignored", reason: "Key up ignored in toggle mode" };
    }

    const pressDuration = Date.now() - this.keyHoldPressStartTime;
    this.lastHoldPressDuration = pressDuration;
    const state = this.lifecycle.snapshot().state;

    if (state === "starting") {
      this.pendingStopOrigin = "physical";
      return { accepted: true, action: "queued_stop", reason: "Key Up during starting state: queued pending stop" };
    } else if (state === "recording") {
      const elapsed = this.recordingStartTime > 0 ? Date.now() - this.recordingStartTime : pressDuration;
      const liveFnDown = this.isFnDownFn();
      const minDuration = getHoldModeMinimumDuration(pressDuration, liveFnDown);
      const remainingDelay = minDuration - elapsed;

      if (pressDuration < SHORT_TAP_THRESHOLD_MS && !liveFnDown && remainingDelay > 0) {
        const recordingSeqId = this.lifecycle.snapshot().sequenceId;
        if (this.shortTapTimer) clearTimeout(this.shortTapTimer);
        this.shortTapTimer = setTimeout(async () => {
          this.shortTapTimer = null;
          const snap = this.lifecycle.snapshot();
          if (snap.sequenceId === recordingSeqId && snap.state === "recording") {
            await this.executeStop(true);
          }
        }, remainingDelay);
        return { accepted: true, action: "queued_stop", reason: "Short tap in Hold Mode: timer started for minimum duration" };
      }

      const ensureMinimumDuration = shouldEnsureMinimumDuration(pressDuration, elapsed);
      return this.executeStop(ensureMinimumDuration);
    }

    return { accepted: false, action: "ignored", reason: `Key up ignored in state ${state}` };
  }

  /** Non-physical / explicit UI commands (Tray menu, IPC, Popover button, CLI) */
  public async handleUiCommand(
    command: "start" | "stop" | "toggle",
    triggerMode: DictationTriggerMode = "dictate"
  ): Promise<CoordinatorActionResult> {
    const state = this.lifecycle.snapshot().state;

    if (command === "start") {
      if (this.mode === "hold" && !this.isNativeKeyUpAvailableFn()) {
        return {
          accepted: false,
          action: "rejected",
          reason: "Accessibility/Input Monitoring permissions required for Hold Mode. Please grant access in System Preferences > Privacy & Security > Accessibility or switch to Toggle Mode.",
          errorCode: "INPUT_MONITORING_REQUIRED",
        };
      }
      if (state === "idle" || state === "error") {
        return this.startRecording(triggerMode);
      }
      return { accepted: false, action: "ignored", reason: `Cannot start from state ${state}` };
    }

    if (command === "stop") {
      if (state === "starting") {
        this.pendingStopOrigin = "explicit";
        return { accepted: true, action: "queued_stop", reason: "Explicit stop during starting state: queued pending stop" };
      } else if (state === "recording") {
        return this.executeStop(false);
      }
      return { accepted: false, action: "ignored", reason: `Cannot stop from state ${state}` };
    }

    // command === "toggle"
    return this.handleToggleCommand("explicit", triggerMode);
  }

  private async handleToggleCommand(
    origin: "physical" | "explicit",
    triggerMode: DictationTriggerMode = "dictate"
  ): Promise<CoordinatorActionResult> {
    const state = this.lifecycle.snapshot().state;

    if (state === "recording") {
      return this.executeStop(false);
    } else if (state === "starting") {
      // Toggle re-triggered during starting: record exactly one pending stop rather than cancelling!
      if (this.pendingStopOrigin === "explicit") {
        return { accepted: true, action: "queued_stop", reason: "Toggle during starting state: stop already pending" };
      }
      this.pendingStopOrigin = origin;
      return { accepted: true, action: "queued_stop", reason: "Toggle during starting state: queued pending stop" };
    } else if (state === "transcribing" || state === "stopping") {
      this.onCancelDictationFn("Cancelled via hotkey");
      return { accepted: true, action: "cancelled", reason: `Toggle during ${state} state cancelled dictation` };
    } else if (state === "idle" || state === "error") {
      if (this.mode === "hold" && !this.isNativeKeyUpAvailableFn()) {
        return {
          accepted: false,
          action: "rejected",
          reason: "Accessibility/Input Monitoring permissions required for Hold Mode. Please grant access in System Preferences > Privacy & Security > Accessibility or switch to Toggle Mode.",
          errorCode: "INPUT_MONITORING_REQUIRED",
        };
      }
      return this.startRecording(triggerMode);
    }

    return { accepted: false, action: "ignored", reason: `Toggle command unhandled in state ${state}` };
  }

  private async startRecording(triggerMode: DictationTriggerMode): Promise<CoordinatorActionResult> {
    this.pendingStopOrigin = null;
    this.recordingStartTime = Date.now();
    this.currentTriggerMode = triggerMode;
    const reqRes = this.lifecycle.requestStart();
    if (!reqRes.accepted) {
      return { accepted: false, action: "rejected", reason: reqRes.reason };
    }

    const startOk = await this.onStartRecordingFn(triggerMode);
    if (!startOk) {
      this.lifecycle.cancel();
      return { accepted: false, action: "rejected", reason: "Start recording handler returned false" };
    }

    return { accepted: true, action: "started" };
  }

  public async acknowledgeStart(seqId: number, success: boolean): Promise<CoordinatorActionResult> {
    const ackRes = this.lifecycle.acknowledgeStart(seqId, success);
    if (!ackRes.accepted) {
      return { accepted: false, action: "rejected", reason: ackRes.reason };
    }

    if (success && this.pendingStopOrigin) {
      const pendingStopOrigin = this.pendingStopOrigin;
      this.pendingStopOrigin = null;
      if (pendingStopOrigin === "physical" && this.mode === "hold") {
        if (this.isFnDownFn()) {
          // Live key is still down, clear pending stop
          return { accepted: true, action: "started", reason: "Live Fn key still down upon recording start" };
        }
        const elapsed = Date.now() - this.recordingStartTime;
        const minDuration = getHoldModeMinimumDuration(this.lastHoldPressDuration, false);
        const delay = Math.max(0, minDuration - elapsed);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      return this.executeStop(false);
    }

    return { accepted: true, action: success ? "started" : "rejected" };
  }

  private async executeStop(ensureMinimumDuration: boolean): Promise<CoordinatorActionResult> {
    if (this.shortTapTimer) {
      clearTimeout(this.shortTapTimer);
      this.shortTapTimer = null;
    }
    const stopRes = this.lifecycle.requestStop();
    if (!stopRes.accepted) {
      return { accepted: false, action: "rejected", reason: stopRes.reason };
    }

    this.playStopChimeFn?.();
    const stoppedOk = await this.onStopRecordingFn(ensureMinimumDuration);
    return { accepted: true, action: "stopped" };
  }
}
