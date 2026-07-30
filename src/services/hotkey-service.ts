import { globalShortcut } from "electron";
import { parseKeyBinding, formatKeyDisplay, formatKeyBinding, type KeyBinding, type DictationMode } from "./config.js";
import { FnHook } from "./fn-hook.js";
import logger from "./logger.js";

export interface HotkeyCallbacks {
  onDown: (mode: "dictate" | "edit") => void;
  onUp?: (mode: "dictate" | "edit") => void;
  onCancel?: () => void;
}

export interface HotkeyRegisterResult {
  success: boolean;
  nativeKeyUpAvailable: boolean;
  fallbackRegistered: boolean;
  binding?: KeyBinding;
  keyDisplay?: string;
  error?: string;
}

export interface IHotkeyService {
  start(
    binding: KeyBinding,
    callbacks: HotkeyCallbacks | ((mode: "dictate" | "edit") => void),
    editBinding?: KeyBinding,
    mode?: DictationMode
  ): Promise<HotkeyRegisterResult>;
  replace(
    newBindingStr: string,
    callbacks: HotkeyCallbacks | ((mode: "dictate" | "edit") => void),
    editBindingStr?: string,
    mode?: DictationMode
  ): Promise<HotkeyRegisterResult>;
  stop(): Promise<void>;
  isFnDown(): boolean;
  isNativeKeyUpAvailable(): boolean;
}

export function bindingToElectronAccelerator(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Control");
  if (binding.meta) parts.push("Command");
  if (binding.alt) parts.push("Option");
  if (binding.shift) parts.push("Shift");

  const formatted = formatKeyBinding(binding);
  const keyPart = formatted.split("+").pop()?.toUpperCase() ?? "V";
  parts.push(keyPart);
  return parts.join("+");
}

export class HotkeyService implements IHotkeyService {
  private currentBinding: KeyBinding | null = null;
  private currentEditBinding: KeyBinding | null = null;
  private currentDisplay: string = "";
  private fnHook: FnHook | null = null;
  private onDownCallback: ((mode: "dictate" | "edit") => void) | null = null;
  private onUpCallback: ((mode: "dictate" | "edit") => void) | null = null;

  async start(
    binding: KeyBinding,
    callbacks: HotkeyCallbacks | ((mode: "dictate" | "edit") => void),
    editBinding?: KeyBinding,
    mode: DictationMode = "toggle"
  ): Promise<HotkeyRegisterResult> {
    this.currentBinding = binding;
    this.currentEditBinding = editBinding ?? null;
    this.currentDisplay = formatKeyDisplay(binding);
    this.onDownCallback = typeof callbacks === "function" ? callbacks : callbacks.onDown;
    this.onUpCallback = typeof callbacks === "function" ? null : (callbacks.onUp ?? null);

    try {
      globalShortcut.unregisterAll();
    } catch {}

    const onCancel = typeof callbacks === "function" ? undefined : callbacks.onCancel;

    // 1. Register native Fn hook via uiohook-napi
    this.fnHook = new FnHook(
      {
        onFnDown: (mode) => this.onDownCallback?.(mode),
        onFnUp: (mode) => this.onUpCallback?.(mode),
        onCancel: () => onCancel?.(),
      },
      binding,
      this.currentDisplay,
      editBinding
    );

    let fnHookStarted = false;
    try {
      this.fnHook.start();
      fnHookStarted = true;
    } catch (err) {
      logger.warn({ err: String(err) }, "Failed to start FnHook listener, evaluating fallback options");
    }

    if (fnHookStarted) {
      return {
        success: true,
        nativeKeyUpAvailable: true,
        fallbackRegistered: false,
        binding,
        keyDisplay: this.currentDisplay,
      };
    }

    // 2. If native key-up listener failed:
    // In HOLD mode, down-only fallback is INVALID because native key-up is required!
    if (mode === "hold") {
      logger.warn("Native key-up unavailable for Hold Mode; rejecting down-only fallback in hold mode");
      return {
        success: false,
        nativeKeyUpAvailable: false,
        fallbackRegistered: false,
        binding,
        keyDisplay: this.currentDisplay,
        error: "Accessibility/Input Monitoring permissions required for Hold Mode. Please grant access in System Preferences > Privacy & Security > Accessibility or switch to Toggle Mode.",
      };
    }

    // In TOGGLE mode, register globalShortcut fallback and check EVERY boolean returned!
    const dictateAcc = bindingToElectronAccelerator(binding);
    const editAcc = editBinding ? bindingToElectronAccelerator(editBinding) : null;

    let regV = false;
    let regE = true;
    let regEsc = true;

    try {
      regV = globalShortcut.register(dictateAcc, () => this.onDownCallback?.("dictate"));
      if (editAcc) {
        regE = globalShortcut.register(editAcc, () => this.onDownCallback?.("edit"));
      }
      if (onCancel) {
        regEsc = globalShortcut.register("Escape", () => onCancel());
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Failed to register globalShortcut fallback");
      try {
        globalShortcut.unregisterAll();
      } catch {}
      return {
        success: false,
        nativeKeyUpAvailable: false,
        fallbackRegistered: false,
        binding,
        keyDisplay: this.currentDisplay,
        error: `Failed to register globalShortcut fallback: ${err}`,
      };
    }

    if (!regV || !regE || !regEsc) {
      logger.warn({ regV, regE, regEsc }, "Failed globalShortcut registration boolean check");
      try {
        globalShortcut.unregisterAll();
      } catch {}
      return {
        success: false,
        nativeKeyUpAvailable: false,
        fallbackRegistered: false,
        binding,
        keyDisplay: this.currentDisplay,
        error: "Global shortcut fallback registration failed (shortcut already in use or unavailable)",
      };
    }

    return {
      success: true,
      nativeKeyUpAvailable: false,
      fallbackRegistered: true,
      binding,
      keyDisplay: this.currentDisplay,
    };
  }

  async replace(
    newBindingStr: string,
    callbacks: HotkeyCallbacks | ((mode: "dictate" | "edit") => void),
    editBindingStr?: string,
    mode: DictationMode = "toggle"
  ): Promise<HotkeyRegisterResult> {
    let candidateBinding: KeyBinding;
    try {
      candidateBinding = parseKeyBinding(newBindingStr);
    } catch (err: any) {
      return { success: false, nativeKeyUpAvailable: false, fallbackRegistered: false, error: err.message };
    }

    let candidateEditBinding: KeyBinding | undefined;
    if (editBindingStr) {
      try {
        candidateEditBinding = parseKeyBinding(editBindingStr);
        this.currentEditBinding = candidateEditBinding;
      } catch (err: any) {
        logger.warn({ err: String(err) }, "Failed to parse edit hotkey binding in replace");
      }
    }

    const previousBinding = this.currentBinding;
    const previousDisplay = this.currentDisplay;

    try {
      this.fnHook?.stop();
      globalShortcut.unregisterAll();
    } catch {}

    const res = await this.start(candidateBinding, callbacks, candidateEditBinding ?? this.currentEditBinding ?? undefined, mode);
    if (!res.success) {
      logger.error({ candidate: newBindingStr, error: res.error }, "Failed hotkey replacement, rolling back");
      if (previousBinding) {
        await this.start(previousBinding, callbacks, this.currentEditBinding ?? undefined, mode);
      }
      return res;
    }

    this.currentBinding = candidateBinding;
    this.currentDisplay = res.keyDisplay || formatKeyDisplay(candidateBinding);
    logger.info({ binding: newBindingStr, display: this.currentDisplay }, "Successfully replaced hotkey binding");
    return res;
  }

  async stop(): Promise<void> {
    try {
      globalShortcut.unregisterAll();
      this.fnHook?.stop();
      this.fnHook = null;
      this.currentBinding = null;
      logger.info("Stopped HotkeyService cleanly");
    } catch (err) {
      logger.error({ err: String(err) }, "Error stopping HotkeyService");
    }
  }

  isFnDown(): boolean {
    return this.fnHook?.isFnDown ?? false;
  }

  isNativeKeyUpAvailable(): boolean {
    return this.fnHook?.isStarted() ?? false;
  }
}
