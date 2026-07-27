import { globalShortcut } from "electron";
import { parseKeyBinding, formatKeyDisplay, type KeyBinding } from "./config.js";
import { FnHook } from "./fn-hook.js";
import logger from "./logger.js";

export interface HotkeyCallbacks {
  onDown: (mode: "dictate" | "edit") => void;
  onUp?: (mode: "dictate" | "edit") => void;
}

export interface IHotkeyService {
  start(binding: KeyBinding, callbacks: HotkeyCallbacks | ((mode: "dictate" | "edit") => void), editBinding?: KeyBinding): Promise<void>;
  replace(newBindingStr: string, callbacks: HotkeyCallbacks | ((mode: "dictate" | "edit") => void), editBindingStr?: string): Promise<{ success: boolean; binding?: KeyBinding; keyDisplay?: string; error?: string }>;
  stop(): Promise<void>;
}

export class HotkeyService implements IHotkeyService {
  private currentBinding: KeyBinding | null = null;
  private currentEditBinding: KeyBinding | null = null;
  private currentDisplay: string = "";
  private fnHook: FnHook | null = null;
  private onDownCallback: ((mode: "dictate" | "edit") => void) | null = null;
  private onUpCallback: ((mode: "dictate" | "edit") => void) | null = null;

  async start(binding: KeyBinding, callbacks: HotkeyCallbacks | ((mode: "dictate" | "edit") => void), editBinding?: KeyBinding): Promise<void> {
    this.currentBinding = binding;
    this.currentEditBinding = editBinding ?? null;
    this.currentDisplay = formatKeyDisplay(binding);
    this.onDownCallback = typeof callbacks === "function" ? callbacks : callbacks.onDown;
    this.onUpCallback = typeof callbacks === "function" ? null : (callbacks.onUp ?? null);

    try {
      globalShortcut.unregisterAll();
    } catch {}

    // 1. Register native Fn hook via uiohook-napi
    this.fnHook = new FnHook(
      {
        onFnDown: (mode) => this.onDownCallback?.(mode),
        onFnUp: (mode) => this.onUpCallback?.(mode),
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
      logger.warn({ err: String(err) }, "Failed to start FnHook listener, using globalShortcut fallback");
    }

    // 2. Register globalShortcut fallback ONLY if FnHook failed to start
    if (!fnHookStarted) {
      try {
        globalShortcut.register("Control+Command+Option+V", () => this.onDownCallback?.("dictate"));
        globalShortcut.register("Control+Command+Option+E", () => this.onDownCallback?.("edit"));
      } catch (err) {
        logger.warn({ err: String(err) }, "Failed to register globalShortcut fallback");
      }
    }
  }

  async replace(newBindingStr: string, callbacks: HotkeyCallbacks | (() => void)): Promise<{ success: boolean; binding?: KeyBinding; keyDisplay?: string; error?: string }> {
    let candidateBinding: KeyBinding;
    try {
      candidateBinding = parseKeyBinding(newBindingStr);
    } catch (err: any) {
      return { success: false, error: err.message };
    }

    const previousBinding = this.currentBinding;
    const previousDisplay = this.currentDisplay;

    try {
      // 1. Stop current registration
      this.fnHook?.stop();
      globalShortcut.unregisterAll();

      // 2. Attempt registration of candidate
      const display = formatKeyDisplay(candidateBinding);
      const onDown = typeof callbacks === "function" ? callbacks : callbacks.onDown;
      const onUp = typeof callbacks === "function" ? undefined : callbacks.onUp;

      this.fnHook = new FnHook(
        {
          onFnDown: (mode) => onDown(mode),
          onFnUp: (mode) => onUp?.(mode),
        },
        candidateBinding,
        display,
        this.currentEditBinding ?? undefined
      );

      let fnHookStarted = false;
      try {
        this.fnHook.start();
        fnHookStarted = true;
      } catch (err) {
        logger.warn({ err: String(err) }, "Failed to start FnHook listener on replace");
      }

      if (!fnHookStarted) {
        globalShortcut.register("Control+Command+Option+V", () => onDown());
      }

      this.currentBinding = candidateBinding;
      this.currentDisplay = display;
      this.onDownCallback = onDown;
      this.onUpCallback = onUp ?? null;

      logger.info({ binding: newBindingStr, display }, "Successfully replaced hotkey binding");
      return { success: true, binding: candidateBinding, keyDisplay: display };
    } catch (err: any) {
      logger.error({ err: String(err), candidate: newBindingStr }, "Failed hotkey replacement, rolling back");
      // 3. Rollback on failure
      if (previousBinding && previousDisplay) {
        await this.start(previousBinding, callbacks);
      }
      return { success: false, error: `Hotkey registration failed: ${err.message}` };
    }
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
}
