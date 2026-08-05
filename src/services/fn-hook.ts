import { uIOhook, UiohookKey } from "uiohook-napi";
import type { UiohookKeyboardEvent } from "uiohook-napi";
import { systemPreferences } from "electron";
import type { KeyBinding } from "./config.js";
import logger from "./logger.js";

export type FnHookCallbacks = {
  onFnDown: (mode: "dictate" | "edit") => void;
  onFnUp: (mode: "dictate" | "edit") => void;
  onCancel?: () => void;
  onTrustLost?: () => void;
};

/**
 * Resolve which UiohookKey codes should trigger "release" for a given modifier/key.
 * Returns an array because left/right variants both count.
 */
function getReleaseCodes(binding: KeyBinding): number[] {
  const codes: number[] = [binding.keycode];

  if (binding.ctrl) {
    codes.push(UiohookKey.Ctrl, UiohookKey.CtrlRight);
  }
  if (binding.shift) {
    codes.push(UiohookKey.Shift, UiohookKey.ShiftRight);
  }
  if (binding.alt) {
    codes.push(UiohookKey.Alt, UiohookKey.AltRight);
  }
  if (binding.meta) {
    codes.push(UiohookKey.Meta, UiohookKey.MetaRight);
  }

  return codes;
}

/**
 * Monitors configurable key combinations globally using uiohook-napi.
 * Triggers onFnDown(mode) when keys are held, onFnUp(mode) when released.
 *
 * Note on native boundary: uiohook-napi manages an underlying macOS CGEventTap.
 * When macOS Accessibility/Input Monitoring trust is revoked at runtime, the CGEventTap
 * is invalidated by the system. FnHook performs non-prompting runtime trust checks
 * and ensures safe, idempotent teardown at VO's lifecycle edge so an invalid tap
 * is stopped and unhooked without freezing or crashing the application.
 *
 * Hot-path contract: key handlers must stay TCC-free. libuiohook's Darwin tap
 * callback synchronously handshakes with VO's main thread on every keydown
 * (unicode-lookup via dispatch_sync_f / main-runloop cond wait). Any work the
 * main thread does per-keystroke delays that handshake; sustained delay trips
 * kCGEventTapDisabledByTimeout and libuiohook's re-enable loop, which stalls
 * HID delivery for every app (uiohook-napi#47, libuiohook#184). Calling
 * systemPreferences.isTrustedAccessibilityClient() per key also creates a
 * teardown path reachable from inside a tap callback: stop() joins the hook
 * thread while the hook thread waits on the main thread -> main/hook deadlock.
 * Trust is therefore polled off-path on a 1s non-prompting timer; a lost poll
 * stops the tap within a second without ever touching the key hot path.
 */
export class FnHook {
  public isFnDown = false;
  private activeMode: "dictate" | "edit" | null = null;
  private callbacks: FnHookCallbacks;
  private started = false;
  private trustLost = false;
  private trustTimer: ReturnType<typeof setInterval> | null = null;
  private binding: KeyBinding;
  private editBinding: KeyBinding | null;
  private releaseCodes: Set<number>;
  private editReleaseCodes: Set<number> | null;
  private displayName: string;
  private keydownHandler: ((event: UiohookKeyboardEvent) => void) | null = null;
  private keyupHandler: ((event: UiohookKeyboardEvent) => void) | null = null;

  constructor(callbacks: FnHookCallbacks, binding: KeyBinding, displayName: string, editBinding?: KeyBinding) {
    this.callbacks = callbacks;
    this.binding = binding;
    this.editBinding = editBinding ?? null;
    this.releaseCodes = new Set(getReleaseCodes(binding));
    this.editReleaseCodes = editBinding ? new Set(getReleaseCodes(editBinding)) : null;
    this.displayName = displayName;
  }

  public isStarted(): boolean {
    return this.started;
  }

  public checkTrust(): boolean {
    if (process.platform === "darwin" || typeof systemPreferences?.isTrustedAccessibilityClient === "function") {
      const trusted = systemPreferences.isTrustedAccessibilityClient(false);
      if (!trusted) {
        this.handleTrustLoss();
        return false;
      }
    }
    return true;
  }

  private handleTrustLoss(): void {
    if (this.trustLost) return;
    this.trustLost = true;
    logger.warn("macOS Accessibility trust lost at runtime; tearing down uIOhook event tap");
    this.stop();
    this.callbacks.onTrustLost?.();
  }

  private startTrustTimer(): void {
    this.clearTrustTimer();
    this.trustTimer = setInterval(() => {
      this.checkTrust();
    }, 1000);
    if (this.trustTimer && typeof this.trustTimer === "object" && "unref" in this.trustTimer) {
      (this.trustTimer as any).unref();
    }
  }

  private clearTrustTimer(): void {
    if (this.trustTimer) {
      clearInterval(this.trustTimer);
      this.trustTimer = null;
    }
  }

  start(): void {
    if (this.started) return;

    // macOS requires accessibility permissions for global keyboard hooks
    if (process.platform === "darwin" || typeof systemPreferences?.isTrustedAccessibilityClient === "function") {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true);
      if (!trusted) {
        throw new Error(
          "Accessibility permissions required. Please grant access in System Preferences > Privacy & Security > Accessibility, then restart the app."
        );
      }
    }

    this.trustLost = false;

    this.keydownHandler = (e: UiohookKeyboardEvent) => {
      // ponytail: no checkTrust() here - trust is polled off-path by the 1s timer.
      // A per-key TCC call (added in #60) runs on the main thread for EVERY system
      // keystroke and can invoke stop() from inside a tap callback, which joins the
      // hook thread -> deadlock (see class doc). Trust loss is detected by the timer
      // within 1s; the tap is then torn down idempotently.
      if (e.keycode === UiohookKey.Escape) {
        this.callbacks.onCancel?.();
        return;
      }

      if (this.activeMode !== null) return; // already active, ignore repeats

      // 1. Check Dictation Key Binding (booleans; equality is exact)
      if (
        e.keycode === this.binding.keycode &&
        e.ctrlKey === this.binding.ctrl &&
        e.shiftKey === this.binding.shift &&
        e.altKey === this.binding.alt &&
        e.metaKey === this.binding.meta
      ) {
        this.activeMode = "dictate";
        this.isFnDown = true;
        this.callbacks.onFnDown("dictate");
        return;
      }

      // 2. Check Voice Edit Key Binding
      if (
        this.editBinding &&
        e.keycode === this.editBinding.keycode &&
        e.ctrlKey === this.editBinding.ctrl &&
        e.shiftKey === this.editBinding.shift &&
        e.altKey === this.editBinding.alt &&
        e.metaKey === this.editBinding.meta
      ) {
        this.activeMode = "edit";
        this.isFnDown = true;
        this.callbacks.onFnDown("edit");
        return;
      }
    };

    this.keyupHandler = (e: UiohookKeyboardEvent) => {
      if (this.activeMode === null) return;

      const currentMode = this.activeMode;
      const targetReleaseCodes = currentMode === "edit" ? this.editReleaseCodes : this.releaseCodes;

      if (targetReleaseCodes && targetReleaseCodes.has(e.keycode)) {
        this.activeMode = null;
        this.isFnDown = false;
        this.callbacks.onFnUp(currentMode);
      }
    };

    uIOhook.on("keydown", this.keydownHandler);
    uIOhook.on("keyup", this.keyupHandler);
    try {
      uIOhook.start();
      this.started = true;
    } catch (err) {
      this.detachListeners();
      throw err;
    }
    logger.info({ key: this.displayName }, "Started monitoring key");

    if (process.platform === "darwin" || typeof systemPreferences?.isTrustedAccessibilityClient === "function") {
      this.startTrustTimer();
    }
  }

  stop(): void {
    this.clearTrustTimer();
    if (!this.started && !this.keydownHandler && !this.keyupHandler) return;
    if (this.started) {
      this.started = false;
      try {
        uIOhook.stop();
      } catch (err) {
        logger.warn({ err: String(err) }, "Error calling uIOhook.stop() during teardown");
      }
    }
    this.detachListeners();
    this.activeMode = null;
    this.isFnDown = false;
    logger.info("Stopped monitoring key");
  }

  private detachListeners(): void {
    if (this.keydownHandler) {
      try {
        uIOhook.off("keydown", this.keydownHandler);
      } catch {
        // Best-effort detach: listener may already be gone on native teardown.
      }
    }
    if (this.keyupHandler) {
      try {
        uIOhook.off("keyup", this.keyupHandler);
      } catch {
        // Best-effort detach: listener may already be gone on native teardown.
      }
    }
    this.keydownHandler = null;
    this.keyupHandler = null;
  }
}
