import { describe, test, expect, beforeEach, mock } from "bun:test";

let isTrustedAccessibilityMock = true;
let registerMockReturn = true;
type KeyCallback = (event: any) => void;
const keydownCallbacks: KeyCallback[] = [];
const keyupCallbacks: KeyCallback[] = [];

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
  systemPreferences: {
    isTrustedAccessibilityClient: () => isTrustedAccessibilityMock,
  },
  globalShortcut: {
    register: () => registerMockReturn,
    unregisterAll: () => {},
  },
}));

// Mock uiohook-napi
mock.module("uiohook-napi", () => ({
  uIOhook: {
    on: (event: string, callback: KeyCallback) => {
      (event === "keydown" ? keydownCallbacks : keyupCallbacks).push(callback);
    },
    off: (event: string, callback: KeyCallback) => {
      const callbacks = event === "keydown" ? keydownCallbacks : keyupCallbacks;
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    },
    start: () => {
      if (!isTrustedAccessibilityMock) {
        throw new Error("uIOhook start failed or permission denied");
      }
    },
    stop: () => {},
  },
  UiohookKey: {
    Escape: 1,
    A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36, K: 37, L: 38, M: 50, N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
    "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10,
    Ctrl: 29,
    CtrlRight: 285,
    Shift: 42,
    ShiftRight: 54,
    Alt: 56,
    AltRight: 312,
    Meta: 3675,
    MetaRight: 3676,
    Semicolon: 39,
    Equal: 13,
    Comma: 51,
    Minus: 12,
    Period: 52,
    Slash: 53,
    Backquote: 41,
    BracketLeft: 26,
    Backslash: 43,
    BracketRight: 27,
    Quote: 40,
  },
}));

const { DictationControlCoordinator } = await import("../../services/dictation-control-coordinator.js");
const { RecordingLifecycle } = await import("../../services/recording-lifecycle.js");
const { HotkeyService } = await import("../../services/hotkey-service.js");
const { parseKeyBinding } = await import("../../services/config.js");
const { globalShortcut } = await import("electron");

function simulateKeyDown(keycode: number, modifiers: Record<string, boolean> = {}) {
  for (const callback of keydownCallbacks) {
    callback({
      keycode,
      ctrlKey: modifiers.ctrlKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      altKey: modifiers.altKey ?? false,
      metaKey: modifiers.metaKey ?? false,
    });
  }
}

function simulateKeyUp(keycode: number) {
  for (const callback of keyupCallbacks) callback({ keycode });
}

describe("PR-07 Dictation Control Coordinator & Hotkey Remediation Suite", () => {
  let lifecycle: InstanceType<typeof RecordingLifecycle>;

  beforeEach(() => {
    lifecycle = new RecordingLifecycle();
    isTrustedAccessibilityMock = true;
    registerMockReturn = true;
    keydownCallbacks.length = 0;
    keyupCallbacks.length = 0;
  });

  test("1. Native hold down/start/up stops once and transcribes", async () => {
    let startCalled = false;
    let stopCalled = false;
    let cancelCalled = false;

    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "hold",
        isNativeKeyUpAvailable: () => true,
        isFnDown: () => false,
        onStartRecording: () => {
          startCalled = true;
          return true;
        },
        onStopRecording: () => {
          stopCalled = true;
          return true;
        },
        onCancelDictation: () => {
          cancelCalled = true;
        },
      },
      lifecycle
    );

    // Down edge in hold mode starts recording flow
    const downRes = await coordinator.handlePhysicalDown("dictate");
    expect(downRes.accepted).toBe(true);
    expect(downRes.action).toBe("started");
    expect(startCalled).toBe(true);
    expect(coordinator.snapshot().state).toBe("starting");

    const seqId = coordinator.snapshot().sequenceId;
    await coordinator.acknowledgeStart(seqId, true);
    expect(coordinator.snapshot().state).toBe("recording");

    // Simulate hold press duration >= 250ms (normal hold release)
    await new Promise((r) => setTimeout(r, 260));

    // Key up edge in hold mode stops recording and transcribes once
    const upRes = await coordinator.handlePhysicalUp();
    expect(upRes.accepted).toBe(true);
    expect(upRes.action).toBe("stopped");
    expect(stopCalled).toBe(true);
    expect(cancelCalled).toBe(false);
    expect(coordinator.snapshot().state).toBe("stopping");
  });

  test("2. Tray/UI stop in hold mode works", async () => {
    let stopCalled = false;

    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "hold",
        isNativeKeyUpAvailable: () => true,
        isFnDown: () => false,
        onStartRecording: () => true,
        onStopRecording: () => {
          stopCalled = true;
          return true;
        },
        onCancelDictation: () => {},
      },
      lifecycle
    );

    await coordinator.handlePhysicalDown("dictate");
    const seqId = coordinator.snapshot().sequenceId;
    await coordinator.acknowledgeStart(seqId, true);
    expect(coordinator.snapshot().state).toBe("recording");

    // Explicit tray/UI stop command while in hold mode
    const uiStopRes = await coordinator.handleUiCommand("stop");
    expect(uiStopRes.accepted).toBe(true);
    expect(uiStopRes.action).toBe("stopped");
    expect(stopCalled).toBe(true);
    expect(coordinator.snapshot().state).toBe("stopping");
  });

  test("3. Down-only hold rejects before start when native key-up is unavailable", async () => {
    let startCalled = false;

    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "hold",
        isNativeKeyUpAvailable: () => false, // FnHook unavailable / permissions revoked
        isFnDown: () => false,
        onStartRecording: () => {
          startCalled = true;
          return true;
        },
        onStopRecording: () => true,
        onCancelDictation: () => {},
      },
      lifecycle
    );

    // Down edge in hold mode without native key-up MUST be rejected before starting
    const downRes = await coordinator.handlePhysicalDown("dictate");
    expect(downRes.accepted).toBe(false);
    expect(downRes.action).toBe("rejected");
    expect(downRes.errorCode).toBe("INPUT_MONITORING_REQUIRED");
    expect(startCalled).toBe(false);
    expect(coordinator.snapshot().state).toBe("idle");
  });

  test("4. Toggle second command during starting queues exactly one stop and never calls cancel; minimum duration still runs", async () => {
    let cancelCalled = false;
    let stopCalled = false;

    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "toggle",
        isNativeKeyUpAvailable: () => true,
        onStartRecording: () => true,
        onStopRecording: () => {
          stopCalled = true;
          return true;
        },
        onCancelDictation: () => {
          cancelCalled = true;
        },
      },
      lifecycle
    );

    // 1st toggle command -> starts recording flow
    const firstRes = await coordinator.handleUiCommand("toggle");
    expect(firstRes.accepted).toBe(true);
    expect(firstRes.action).toBe("started");
    expect(coordinator.snapshot().state).toBe("starting");

    // 2nd toggle command during starting state -> queues exactly one pending stop
    const secondRes = await coordinator.handleUiCommand("toggle");
    expect(secondRes.accepted).toBe(true);
    expect(secondRes.action).toBe("queued_stop");
    expect(coordinator.isPendingStop()).toBe(true);
    expect(cancelCalled).toBe(false);

    // 3rd toggle command during starting state -> pending stop remains queued (idempotent, single stop)
    const thirdRes = await coordinator.handleUiCommand("toggle");
    expect(thirdRes.accepted).toBe(true);
    expect(thirdRes.action).toBe("queued_stop");
    expect(coordinator.isPendingStop()).toBe(true);
    expect(cancelCalled).toBe(false);

    // Once capture acknowledges start, queued stop executes normal stop path
    const seqId = coordinator.snapshot().sequenceId;
    const ackRes = await coordinator.acknowledgeStart(seqId, true);
    expect(ackRes.accepted).toBe(true);
    expect(ackRes.action).toBe("stopped");
    expect(stopCalled).toBe(true);
    expect(cancelCalled).toBe(false);
    expect(coordinator.snapshot().state).toBe("stopping");
  });

  test("5. Explicit startup stop overrides a still-held physical key", async () => {
    let stopCalled = false;
    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "hold",
        isNativeKeyUpAvailable: () => true,
        isFnDown: () => true,
        onStartRecording: () => true,
        onStopRecording: () => {
          stopCalled = true;
          return true;
        },
        onCancelDictation: () => {},
      },
      lifecycle
    );

    await coordinator.handlePhysicalDown();
    await coordinator.handleUiCommand("stop");
    const result = await coordinator.acknowledgeStart(coordinator.snapshot().sequenceId, true);

    expect(result.action).toBe("stopped");
    expect(stopCalled).toBe(true);
  });

  test("8. Re-registering while a hold is starting is rejected without losing the release edge", async () => {
    const hotkeyService = new HotkeyService();
    let stopCalled = 0;
    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "hold",
        isNativeKeyUpAvailable: () => hotkeyService.isNativeKeyUpAvailable(),
        isFnDown: () => hotkeyService.isFnDown(),
        onStartRecording: () => true,
        onStopRecording: () => {
          stopCalled += 1;
          return true;
        },
        onCancelDictation: () => {},
      },
      lifecycle
    );
    const callbacks = {
      onDown: (mode: "dictate" | "edit") => void coordinator.handlePhysicalDown(mode),
      onUp: () => void coordinator.handlePhysicalUp(),
    };
    const binding = parseKeyBinding("ctrl+cmd+option+v");
    await hotkeyService.start(binding, callbacks, undefined, "hold");

    simulateKeyDown(binding.keycode, { ctrlKey: true, altKey: true, metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(coordinator.snapshot().state).toBe("starting");

    const replacement = await hotkeyService.replace("ctrl+cmd+option+e", callbacks, undefined, "hold");
    expect(replacement.success).toBe(false);
    expect(coordinator.snapshot().state).toBe("starting");

    await coordinator.acknowledgeStart(coordinator.snapshot().sequenceId, true);
    simulateKeyUp(binding.keycode);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(stopCalled).toBe(1);
    expect(coordinator.snapshot().state).toBe("stopping");
    await hotkeyService.stop();
  });

  test("9. Re-registering while recording is rejected and the current binding still stops", async () => {
    const hotkeyService = new HotkeyService();
    let stopCalled = 0;
    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "hold",
        isNativeKeyUpAvailable: () => hotkeyService.isNativeKeyUpAvailable(),
        isFnDown: () => hotkeyService.isFnDown(),
        onStartRecording: () => true,
        onStopRecording: () => {
          stopCalled += 1;
          return true;
        },
        onCancelDictation: () => {},
      },
      lifecycle
    );
    const callbacks = {
      onDown: (mode: "dictate" | "edit") => void coordinator.handlePhysicalDown(mode),
      onUp: () => void coordinator.handlePhysicalUp(),
    };
    const binding = parseKeyBinding("ctrl+cmd+option+v");
    await hotkeyService.start(binding, callbacks, undefined, "hold");

    simulateKeyDown(binding.keycode, { ctrlKey: true, altKey: true, metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 260));
    await coordinator.acknowledgeStart(coordinator.snapshot().sequenceId, true);
    expect(coordinator.snapshot().state).toBe("recording");

    const replacement = await hotkeyService.replace("ctrl+cmd+option+e", callbacks, undefined, "hold");
    expect(replacement.success).toBe(false);
    simulateKeyUp(binding.keycode);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(stopCalled).toBe(1);
    expect(coordinator.snapshot().state).toBe("stopping");
    await hotkeyService.stop();
  });

  test("10. Starting a new binding retires the old native shortcut listener", async () => {
    const hotkeyService = new HotkeyService();
    let downCount = 0;
    const callbacks = {
      onDown: () => {
        downCount += 1;
      },
      onUp: () => {},
    };
    await hotkeyService.start(parseKeyBinding("ctrl+cmd+option+v"), callbacks, undefined, "hold");
    await hotkeyService.start(parseKeyBinding("ctrl+cmd+option+e"), callbacks, undefined, "hold");

    simulateKeyDown(47, { ctrlKey: true, altKey: true, metaKey: true });
    simulateKeyDown(18, { ctrlKey: true, altKey: true, metaKey: true });
    expect(downCount).toBe(1);
    await hotkeyService.stop();
  });

  test("6. False fallback registration reports failure in HotkeyService", async () => {
    const hotkeyService = new HotkeyService();
    registerMockReturn = false; // Simulate globalShortcut.register returning false

    const binding = parseKeyBinding("ctrl+cmd+option+v");
    isTrustedAccessibilityMock = false; // Force fallback path
    const result = await hotkeyService.start(
      binding,
      { onDown: () => {}, onUp: () => {} },
      undefined,
      "toggle"
    );

    // Down-only fallback registration must check return boolean and report failure if false
    expect(result.success).toBe(false);
    expect(result.fallbackRegistered).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("7. Hold mode rejects down-only fallback when native key-up fails to start in HotkeyService", async () => {
    isTrustedAccessibilityMock = false; // Simulate revoked Input Monitoring / Accessibility permission
    const hotkeyService = new HotkeyService();

    const binding = parseKeyBinding("ctrl+cmd+option+v");
    const result = await hotkeyService.start(
      binding,
      { onDown: () => {}, onUp: () => {} },
      undefined,
      "hold"
    );

    // When native key-up listener fails in hold mode, it MUST reject down-only fallback and report error.
    expect(result.success).toBe(false);
    expect(result.nativeKeyUpAvailable).toBe(false);
    expect(result.fallbackRegistered).toBe(false);
    expect(result.error).toContain("Accessibility/Input Monitoring permissions required for Hold Mode");
  });
});
