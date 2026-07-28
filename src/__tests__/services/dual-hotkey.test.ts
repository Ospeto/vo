import { describe, expect, test, mock } from "bun:test";
import { parseKeyBinding, formatKeyDisplay } from "../../services/config.js";

const registeredShortcuts = new Map<string, Function>();

mock.module("electron", () => ({
  globalShortcut: {
    register: mock((shortcut: string, cb: Function) => {
      registeredShortcuts.set(shortcut, cb);
      return true;
    }),
    unregisterAll: mock(() => {
      registeredShortcuts.clear();
    }),
  },
  systemPreferences: {
    isTrustedAccessibilityClient: mock(() => false),
  },
}));

mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

mock.module("uiohook-napi", () => ({
  uIOhook: {
    on: mock(() => {}),
    start: mock(() => {
      throw new Error("uIOhook unavailable in test environment");
    }),
    stop: mock(() => {}),
  },
  UiohookKey: {},
}));

describe("Dual Hotkey Configuration & Parsing Suite", () => {
  test("parses dictation key binding (Ctrl+Cmd+Opt+V) correctly", () => {
    const binding = parseKeyBinding("ctrl+cmd+option+v");
    expect(binding.ctrl).toBe(true);
    expect(binding.meta).toBe(true);
    expect(binding.alt).toBe(true);
  });

  test("parses edit key binding (Ctrl+Cmd+Opt+E) correctly", () => {
    const editBinding = parseKeyBinding("ctrl+cmd+option+e");
    expect(editBinding.ctrl).toBe(true);
    expect(editBinding.meta).toBe(true);
    expect(editBinding.alt).toBe(true);
    expect(formatKeyDisplay(editBinding)).toContain("E");
  });

  test("HotkeyService.replace applies edit binding and registers fallback edit hotkey", async () => {
    const { HotkeyService } = await import("../../services/hotkey-service.js");
    const hotkeyService = new HotkeyService();

    let triggeredMode = "";
    const callbacks = (mode: "dictate" | "edit") => {
      triggeredMode = mode;
    };

    const result = await hotkeyService.replace("ctrl+cmd+option+v", callbacks, "ctrl+cmd+option+e");
    expect(result.success).toBe(true);

    expect(registeredShortcuts.has("Control+Command+Option+V")).toBe(true);
    expect(registeredShortcuts.has("Control+Command+Option+E")).toBe(true);

    const editCb = registeredShortcuts.get("Control+Command+Option+E");
    editCb?.();
    expect(triggeredMode).toBe("edit");
  });
});
