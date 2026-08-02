import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock logger
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

let isTrustedMock = true;

// Mock electron
mock.module("electron", () => ({
  app: {
    name: "vo",
    setName: () => {},
    on: () => {},
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    dock: { hide: () => {} },
    quit: () => {},
  },
  BrowserWindow: class {
    webContents = { send: () => {}, on: () => {}, once: () => {} };
    isDestroyed() { return false; }
    destroy() {}
    showInactive() {}
    hide() {}
  },
  ipcMain: { on: () => {}, handle: () => {} },
  clipboard: { readText: () => "", writeText: () => {}, readBuffer: () => Buffer.from(""), writeBuffer: () => true },
  Tray: class { setToolTip() {} on() {} setImage() {} },
  Menu: { buildFromTemplate: () => ({}) },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  nativeImage: { createFromPath: () => ({ setTemplateImage: () => {} }) },
  Notification: class { static isSupported() { return false; } show() {} },
  systemPreferences: {
    isTrustedAccessibilityClient: mock((prompt?: boolean) => isTrustedMock),
  },
  globalShortcut: {
    register: mock(() => true),
    unregisterAll: mock(() => {}),
  },
}));

// Mock uiohook-napi
type KeyCallback = (event: any) => void;
const keydownCallbacks: KeyCallback[] = [];
const keyupCallbacks: KeyCallback[] = [];
let uiohookStarted = false;

const mockUIOhook = {
  on: mock((event: string, cb: KeyCallback) => {
    if (event === "keydown") keydownCallbacks.push(cb);
    if (event === "keyup") keyupCallbacks.push(cb);
  }),
  off: mock((event: string, cb: KeyCallback) => {
    const callbacks = event === "keydown" ? keydownCallbacks : keyupCallbacks;
    const index = callbacks.indexOf(cb);
    if (index >= 0) callbacks.splice(index, 1);
  }),
  start: mock(() => {
    uiohookStarted = true;
  }),
  stop: mock(() => {
    uiohookStarted = false;
  }),
};

mock.module("uiohook-napi", () => ({
  uIOhook: mockUIOhook,
  UiohookKey: {
    A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35,
    I: 23, J: 36, K: 37, L: 38, M: 50, N: 49, O: 24, P: 25,
    Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45,
    Y: 21, Z: 44,
    Ctrl: 29, CtrlRight: 97, Shift: 42, ShiftRight: 54,
    Alt: 56, AltRight: 100, Meta: 125, MetaRight: 126,
    Escape: 1, Space: 57,
  },
}));

const { FnHook } = await import("../../services/fn-hook.js");
const { HotkeyService } = await import("../../services/hotkey-service.js");

describe("macOS Accessibility Runtime Revocation Protection Suite", () => {
  beforeEach(() => {
    isTrustedMock = true;
    keydownCallbacks.length = 0;
    keyupCallbacks.length = 0;
    uiohookStarted = false;
    mockUIOhook.on.mockClear();
    mockUIOhook.off.mockClear();
    mockUIOhook.start.mockClear();
    mockUIOhook.stop.mockClear();
  });

  test("startup with permission granted starts native FnHook successfully", async () => {
    const service = new HotkeyService();
    const binding = { keycode: 47, ctrl: true, shift: false, alt: false, meta: true }; // ctrl+cmd+v
    const res = await service.start(binding, { onDown: () => {}, onUp: () => {} }, undefined, "hold");

    expect(res.success).toBe(true);
    expect(res.nativeKeyUpAvailable).toBe(true);
    expect(service.isNativeKeyUpAvailable()).toBe(true);
    await service.stop();
  });

  test("startup with permission denied rejects Hold Mode and returns error without crashing", async () => {
    isTrustedMock = false;
    const service = new HotkeyService();
    const binding = { keycode: 47, ctrl: true, shift: false, alt: false, meta: true };
    const res = await service.start(binding, { onDown: () => {}, onUp: () => {} }, undefined, "hold");

    expect(res.success).toBe(false);
    expect(res.nativeKeyUpAvailable).toBe(false);
    expect(res.error).toContain("Accessibility/Input Monitoring permissions required");
    expect(service.isNativeKeyUpAvailable()).toBe(false);
    await service.stop();
  });

  test("runtime trust revocation triggers onTrustLost, stops FnHook, and reports nativeKeyUpAvailable=false", async () => {
    const { systemPreferences } = await import("electron");
    const service = new HotkeyService();
    const onTrustLost = mock(() => {});
    const binding = { keycode: 47, ctrl: true, shift: false, alt: false, meta: true };

    const res = await service.start(
      binding,
      { onDown: () => {}, onUp: () => {}, onTrustLost },
      undefined,
      "hold"
    );

    expect(res.success).toBe(true);
    expect(service.isNativeKeyUpAvailable()).toBe(true);

    // Revoke accessibility permission while app is running
    isTrustedMock = false;

    // Simulate FnHook trust check
    const fnHook = (service as any).fnHook;
    expect(fnHook).not.toBeNull();
    const isOk = fnHook.checkTrust();

    expect(isOk).toBe(false);
    expect(onTrustLost).toHaveBeenCalledTimes(1);
    expect(service.isNativeKeyUpAvailable()).toBe(false);
    expect(mockUIOhook.stop).toHaveBeenCalled();
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(false);

    await service.stop();
  });

  test("repeated trust loss checks are safe and idempotent", async () => {
    const service = new HotkeyService();
    const onTrustLost = mock(() => {});
    const binding = { keycode: 47, ctrl: true, shift: false, alt: false, meta: true };

    await service.start(
      binding,
      { onDown: () => {}, onUp: () => {}, onTrustLost },
      undefined,
      "hold"
    );

    isTrustedMock = false;
    const fnHook = (service as any).fnHook;

    // Multiple checks
    fnHook.checkTrust();
    fnHook.checkTrust();
    await service.stop();
    await service.stop();

    expect(onTrustLost).toHaveBeenCalledTimes(1);
    expect(service.isNativeKeyUpAvailable()).toBe(false);
  });
});
