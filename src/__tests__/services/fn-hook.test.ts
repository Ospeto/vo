import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock logger
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Mock electron
mock.module("electron", () => ({
  app: { name: "vo", setName: () => {}, on: () => {}, whenReady: () => Promise.resolve(), requestSingleInstanceLock: () => true, dock: { hide: () => {} }, quit: () => {} },
  BrowserWindow: class { webContents = { send: () => {}, on: () => {}, once: () => {} }; isDestroyed() { return false; } destroy() {} },
  ipcMain: { on: () => {}, handle: () => {} },
  clipboard: { readText: () => "", writeText: () => {}, readBuffer: () => Buffer.from(""), writeBuffer: () => true },
  Tray: class { setToolTip() {} on() {} setImage() {} },
  Menu: { buildFromTemplate: () => ({}) },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  nativeImage: { createFromPath: () => ({ setTemplateImage: () => {} }) },
  Notification: class { static isSupported() { return false; } show() {} },
  systemPreferences: {
    isTrustedAccessibilityClient: mock(() => true),
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
    // native tap lifecycle is exercised live; unit tests only observe calls
  }),
  stop: mock(() => {
    // see start
  }),
};

mock.module("uiohook-napi", () => ({
  uIOhook: mockUIOhook,
  UiohookKey: {
    A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35,
    I: 23, J: 36, K: 37, L: 38, M: 50, N: 49, O: 24, P: 25,
    Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45,
    Y: 21, Z: 44,
    0: 11, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10,
    F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64,
    F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
    Space: 57, Enter: 28, Escape: 1, Tab: 15,
    Backspace: 14, Delete: 111, Insert: 110,
    Home: 102, End: 107, PageUp: 104, PageDown: 109,
    ArrowUp: 103, ArrowDown: 108, ArrowLeft: 105, ArrowRight: 106,
    Ctrl: 29, CtrlRight: 97, Shift: 42, ShiftRight: 54,
    Alt: 56, AltRight: 100, Meta: 125, MetaRight: 126,
    Semicolon: 39, Equal: 13, Comma: 51, Minus: 12,
    Period: 52, Slash: 53, Backquote: 41,
    BracketLeft: 26, Backslash: 43, BracketRight: 27, Quote: 40,
  },
}));

const { FnHook } = await import("../../services/fn-hook.js");

function simulateKeyDown(keycode: number, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) {
  for (const cb of keydownCallbacks) {
    cb({
      keycode,
      ctrlKey: modifiers.ctrlKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      altKey: modifiers.altKey ?? false,
      metaKey: modifiers.metaKey ?? false,
    });
  }
}

function simulateKeyUp(keycode: number) {
  for (const cb of keyupCallbacks) {
    cb({ keycode });
  }
}

const activeHooks: InstanceType<typeof FnHook>[] = [];

function createHook(...args: ConstructorParameters<typeof FnHook>): InstanceType<typeof FnHook> {
  const hook = new FnHook(...args);
  activeHooks.push(hook);
  return hook;
}

describe("FnHook", () => {
  beforeEach(() => {
    keydownCallbacks.length = 0;
    keyupCallbacks.length = 0;
    mockUIOhook.on.mockClear();
    mockUIOhook.off.mockClear();
    mockUIOhook.start.mockClear();
    mockUIOhook.stop.mockClear();
  });

  afterEach(() => {
    for (const hook of activeHooks) {
      hook.stop();
    }
    activeHooks.length = 0;
  });

  test("starts uiohook on start()", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false }; // ctrl+t
    const hook = createHook(callbacks, binding, "ctrl+t");

    hook.start();
    expect(mockUIOhook.start).toHaveBeenCalled();
    expect(mockUIOhook.on).toHaveBeenCalled();
  });

  test("does not double-start", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook(callbacks, binding, "t");

    hook.start();
    hook.start(); // second call should be no-op
    expect(mockUIOhook.start).toHaveBeenCalledTimes(1);
  });

  test("calls onFnDown when key combo matches", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown, onFnUp }, binding, "ctrl+t");

    hook.start();
    simulateKeyDown(20, { ctrlKey: true });

    expect(onFnDown).toHaveBeenCalledTimes(1);
  });

  test("does not call onFnDown when modifiers don't match", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown, onFnUp }, binding, "ctrl+t");

    hook.start();

    // Wrong modifier: shift instead of ctrl
    simulateKeyDown(20, { shiftKey: true });
    expect(onFnDown).not.toHaveBeenCalled();

    // Right key, no modifier
    simulateKeyDown(20, {});
    expect(onFnDown).not.toHaveBeenCalled();
  });

  test("calls onFnUp when release key matches", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown, onFnUp }, binding, "ctrl+t");

    hook.start();

    // Press
    simulateKeyDown(20, { ctrlKey: true });
    expect(onFnDown).toHaveBeenCalledTimes(1);

    // Release main key
    simulateKeyUp(20);
    expect(onFnUp).toHaveBeenCalledTimes(1);
  });

  test("calls onFnUp when modifier key is released", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: true, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown, onFnUp }, binding, "ctrl+t");

    hook.start();
    simulateKeyDown(20, { ctrlKey: true });

    // Release ctrl (left) instead of main key
    simulateKeyUp(29); // UiohookKey.Ctrl
    expect(onFnUp).toHaveBeenCalledTimes(1);
  });

  test("does not fire onFnUp when unrelated key released", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown, onFnUp }, binding, "t");

    hook.start();
    simulateKeyDown(20, {});

    // Release unrelated key (e.g., 'a' = 30)
    simulateKeyUp(30);
    expect(onFnUp).not.toHaveBeenCalled();

    // Release actual key
    simulateKeyUp(20);
    expect(onFnUp).toHaveBeenCalledTimes(1);
  });

  test("ignores repeat keydowns while active", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown, onFnUp }, binding, "t");

    hook.start();
    simulateKeyDown(20, {});
    simulateKeyDown(20, {}); // repeat
    simulateKeyDown(20, {}); // repeat

    expect(onFnDown).toHaveBeenCalledTimes(1);
  });

  test("does not call onFnUp when not active", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown, onFnUp }, binding, "t");

    hook.start();

    // Release without press
    simulateKeyUp(20);
    expect(onFnUp).not.toHaveBeenCalled();
  });

  test("stop() stops uiohook and detaches retired listeners", () => {
    const onFnDown = mock(() => {});
    const callbacks = { onFnDown, onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook(callbacks, binding, "t");

    hook.start();
    hook.stop();
    simulateKeyDown(20);

    expect(mockUIOhook.stop).toHaveBeenCalled();
    expect(mockUIOhook.off).toHaveBeenCalledTimes(2);
    expect(onFnDown).not.toHaveBeenCalled();
  });

  test("stop() is no-op when not started", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook(callbacks, binding, "t");

    hook.stop(); // should not throw
    expect(mockUIOhook.stop).not.toHaveBeenCalled();
  });

  test("isFnDown tracks active state", () => {
    const callbacks = { onFnDown: mock(() => {}), onFnUp: mock(() => {}) };
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook(callbacks, binding, "t");

    expect(hook.isFnDown).toBe(false);

    hook.start();
    simulateKeyDown(20, {});
    expect(hook.isFnDown).toBe(true);

    simulateKeyUp(20);
    expect(hook.isFnDown).toBe(false);
  });

  test("handles meta+shift+i binding (default)", () => {
    const onFnDown = mock(() => {});
    const onFnUp = mock(() => {});
    // meta+shift+i: keycode=23 (I), meta=true, shift=true
    const binding = { keycode: 23, ctrl: false, shift: true, alt: false, meta: true };
    const hook = createHook({ onFnDown, onFnUp }, binding, "meta+shift+i");

    hook.start();
    simulateKeyDown(23, { metaKey: true, shiftKey: true });
    expect(onFnDown).toHaveBeenCalledTimes(1);

    // Release shift triggers release
    simulateKeyUp(42); // UiohookKey.Shift
    expect(onFnUp).toHaveBeenCalledTimes(1);
  });

  test("runtime trust loss triggers onTrustLost callback and stops uIOhook cleanly", async () => {
    const { systemPreferences } = await import("electron");
    let trustedMock = true;
    (systemPreferences.isTrustedAccessibilityClient as any).mockImplementation(() => trustedMock);

    const onTrustLost = mock(() => {});
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown: mock(() => {}), onFnUp: mock(() => {}), onTrustLost }, binding, "t");

    hook.start();
    expect(hook.isStarted()).toBe(true);

    // Simulate runtime revocation of Accessibility permission
    trustedMock = false;

    // Check trust explicitly
    const isOk = hook.checkTrust();
    expect(isOk).toBe(false);
    expect(hook.isStarted()).toBe(false);
    expect(onTrustLost).toHaveBeenCalledTimes(1);
    expect(mockUIOhook.stop).toHaveBeenCalled();
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(false);

    // Repeated checkTrust is idempotent
    hook.checkTrust();
    expect(onTrustLost).toHaveBeenCalledTimes(1);

    hook.stop();
    // Restore mock default
    (systemPreferences.isTrustedAccessibilityClient as any).mockImplementation(() => true);
  });

  test("key events stay off the TCC hot path: no trust check or teardown from key handlers", async () => {
    const { systemPreferences } = await import("electron");
    let trustedMock = true;
    (systemPreferences.isTrustedAccessibilityClient as any).mockImplementation(() => trustedMock);

    const onFnDown = mock(() => {});
    const onTrustLost = mock(() => {});
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown, onFnUp: mock(() => {}), onTrustLost }, binding, "t");

    hook.start();
    // start() performs exactly one (prompting) trust check
    (systemPreferences.isTrustedAccessibilityClient as any).mockClear();

    // Key events must never trigger TCC calls on the main thread: libuiohook's
    // Darwin tap handshakes with the main thread on every keydown, so per-key TCC
    // round-trips feed kCGEventTapDisabledByTimeout storms and allow stop()
    // (which joins the hook thread) to be reached from inside a tap callback,
    // deadlocking main <-> hook. Trust loss is detected by the 1s off-path poll.
    simulateKeyDown(20, {});
    simulateKeyUp(20);
    expect(onFnDown).toHaveBeenCalledTimes(1);
    expect(systemPreferences.isTrustedAccessibilityClient).not.toHaveBeenCalled();
    expect(hook.isStarted()).toBe(true);

    // Even with trust already revoked, a key event does not stop the hook or
    // invoke teardown from the event path - the poll owns that transition.
    trustedMock = false;
    simulateKeyDown(20, {});
    expect(onTrustLost).not.toHaveBeenCalled();
    expect(hook.isStarted()).toBe(true);
    expect(systemPreferences.isTrustedAccessibilityClient).not.toHaveBeenCalled();

    hook.stop();
    (systemPreferences.isTrustedAccessibilityClient as any).mockImplementation(() => true);
  });

  test("stop() is idempotent and handles uIOhook.stop() native exceptions gracefully", () => {
    const binding = { keycode: 20, ctrl: false, shift: false, alt: false, meta: false };
    const hook = createHook({ onFnDown: mock(() => {}), onFnUp: mock(() => {}) }, binding, "t");

    hook.start();

    // Force uIOhook.stop to throw (simulating broken native CGEventTap on revocation)
    mockUIOhook.stop.mockImplementationOnce(() => {
      throw new Error("CGEventTap is invalid");
    });

    expect(() => hook.stop()).not.toThrow();
    expect(hook.isStarted()).toBe(false);
    expect(mockUIOhook.off).toHaveBeenCalled();

    // Second stop call is safe no-op
    expect(() => hook.stop()).not.toThrow();
  });
});
