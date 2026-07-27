import { uIOhook, UiohookKey } from "uiohook-napi";
import type { UiohookKeyboardEvent } from "uiohook-napi";
import { systemPreferences } from "electron";
import type { KeyBinding } from "./config.js";
import logger from "./logger.js";

export type FnHookCallbacks = {
  onFnDown: (mode: "dictate" | "edit") => void;
  onFnUp: (mode: "dictate" | "edit") => void;
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
 */
export class FnHook {
  public isFnDown = false;
  private activeMode: "dictate" | "edit" | null = null;
  private callbacks: FnHookCallbacks;
  private started = false;
  private binding: KeyBinding;
  private editBinding: KeyBinding | null;
  private releaseCodes: Set<number>;
  private editReleaseCodes: Set<number> | null;
  private displayName: string;

  constructor(callbacks: FnHookCallbacks, binding: KeyBinding, displayName: string, editBinding?: KeyBinding) {
    this.callbacks = callbacks;
    this.binding = binding;
    this.editBinding = editBinding ?? null;
    this.releaseCodes = new Set(getReleaseCodes(binding));
    this.editReleaseCodes = editBinding ? new Set(getReleaseCodes(editBinding)) : null;
    this.displayName = displayName;
  }

  start(): void {
    if (this.started) return;

    // macOS requires accessibility permissions for global keyboard hooks
    if (process.platform === "darwin") {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true);
      if (!trusted) {
        throw new Error(
          "Accessibility permissions required. Please grant access in System Preferences > Privacy & Security > Accessibility, then restart the app."
        );
      }
    }

    uIOhook.on("keydown", (e: UiohookKeyboardEvent) => {
      if (this.activeMode !== null) return; // already active, ignore repeats

      // 1. Check Dictation Key Binding
      if (
        e.keycode === this.binding.keycode &&
        !e.ctrlKey === !this.binding.ctrl &&
        !e.shiftKey === !this.binding.shift &&
        !e.altKey === !this.binding.alt &&
        !e.metaKey === !this.binding.meta
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
        !e.ctrlKey === !this.editBinding.ctrl &&
        !e.shiftKey === !this.editBinding.shift &&
        !e.altKey === !this.editBinding.alt &&
        !e.metaKey === !this.editBinding.meta
      ) {
        this.activeMode = "edit";
        this.isFnDown = true;
        this.callbacks.onFnDown("edit");
        return;
      }
    });

    uIOhook.on("keyup", (e: UiohookKeyboardEvent) => {
      if (this.activeMode === null) return;

      const currentMode = this.activeMode;
      const targetReleaseCodes = currentMode === "edit" ? this.editReleaseCodes : this.releaseCodes;

      if (targetReleaseCodes && targetReleaseCodes.has(e.keycode)) {
        this.activeMode = null;
        this.isFnDown = false;
        this.callbacks.onFnUp(currentMode);
      }
    });

    uIOhook.start();
    this.started = true;
    logger.info({ key: this.displayName }, "Started monitoring key");
  }

  stop(): void {
    if (!this.started) return;
    uIOhook.stop();
    this.started = false;
    this.activeMode = null;
    this.isFnDown = false;
    logger.info("Stopped monitoring key");
  }
}
