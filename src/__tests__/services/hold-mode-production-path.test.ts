import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock uiohook-napi native event source
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
    "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10,
    Space: 57, Enter: 28, Escape: 1, Tab: 15,
    Backspace: 14, Delete: 111, Insert: 110,
    Ctrl: 29, CtrlRight: 97, Shift: 42, ShiftRight: 54,
    Alt: 56, AltRight: 100, Meta: 125, MetaRight: 126,
  },
}));

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
const mockElectronObj = {
  app: {
    name: "vo",
    setName: () => {},
    dock: { hide: () => {} },
    requestSingleInstanceLock: () => true,
    on: () => {},
    whenReady: () => Promise.resolve(),
    quit: () => {},
    exit: () => {},
  },
  BrowserWindow: class MockBrowserWindow {
    static getAllWindows() { return []; }
    webContents = { send: () => {}, on: () => {}, once: () => {}, setWindowOpenHandler: () => {} };
    isDestroyed() { return false; }
    destroy() {}
    hide() {}
    showInactive() {}
    focus() {}
    loadFile() {}
    on() {}
    once() {}
  },
  ipcMain: { on: () => {}, handle: () => {} },
  Tray: class MockTray {
    setImage() {}
    setToolTip() {}
    on() {}
    popUpContextMenu() {}
    destroy() {}
  },
  Menu: { buildFromTemplate: () => ({}) },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  nativeImage: { createFromPath: () => ({ setTemplateImage: () => {} }) },
  clipboard: { readText: () => "", writeText: () => {} },
  Notification: class { static isSupported() { return false; } show() {} },
  systemPreferences: { isTrustedAccessibilityClient: () => true },
  globalShortcut: { register: () => true, unregisterAll: () => {} },
};

mock.module("electron", () => ({
  ...mockElectronObj,
  default: mockElectronObj,
}));

function simulateKeyDown(keycode: number, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) {
  for (const cb of [...keydownCallbacks]) {
    cb({
      keycode,
      ctrlKey: modifiers.ctrlKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      altKey: modifiers.altKey ?? false,
      metaKey: modifiers.metaKey ?? false,
    });
  }
}

function simulateKeyUp(keycode: number, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) {
  for (const cb of [...keyupCallbacks]) {
    cb({
      keycode,
      ctrlKey: modifiers.ctrlKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      altKey: modifiers.altKey ?? false,
      metaKey: modifiers.metaKey ?? false,
    });
  }
}

// Imports after mocks
const { DictationControlCoordinator } = await import("../../services/dictation-control-coordinator.js");
const { RecordingLifecycle } = await import("../../services/recording-lifecycle.js");
const { HotkeyService } = await import("../../services/hotkey-service.js");
const { parseKeyBinding } = await import("../../services/config.js");
const mainModule = await import("../../main.js");

describe("Production-Path Hold & Toggle Mode Integration Test Suite", () => {
  let hotkeyService: InstanceType<typeof HotkeyService>;
  let coordinator: InstanceType<typeof DictationControlCoordinator>;
  let lifecycle: InstanceType<typeof RecordingLifecycle>;
  let startCalls: number;
  let stopCalls: boolean[];
  let cancelCalls: string[];

  // Meta+Shift+I binding: keycode 23 (I), meta=true, shift=true
  const testBinding = parseKeyBinding("meta+shift+i");
  const hotkeyKeycode = 23; // I keycode in UiohookKey

  beforeEach(async () => {
    startCalls = 0;
    stopCalls = [];
    cancelCalls = [];
    keydownCallbacks.length = 0;
    keyupCallbacks.length = 0;

    lifecycle = new RecordingLifecycle();
    hotkeyService = new HotkeyService();

    coordinator = new DictationControlCoordinator(
      {
        dictationMode: "hold",
        isNativeKeyUpAvailable: () => hotkeyService.isNativeKeyUpAvailable(),
        isFnDown: () => hotkeyService.isFnDown(),
        onStartRecording: async () => {
          startCalls++;
          return true;
        },
        onStopRecording: async (ensureMinDuration: boolean) => {
          stopCalls.push(ensureMinDuration);
          return true;
        },
        onCancelDictation: (reason: string) => {
          cancelCalls.push(reason);
        },
      },
      lifecycle
    );

    // Wire main.ts export seam dictationCoordinator to test coordinator
    mainModule.setDictationCoordinatorForTests(coordinator);

    // Start real HotkeyService using real FnHook with main.ts callbacks seam
    const callbacks = mainModule.createMainHotkeyCallbacks();
    await hotkeyService.start(testBinding, callbacks, undefined, "hold");
  });

  afterEach(async () => {
    await hotkeyService.stop();
    coordinator.reset();
  });

  describe("1. Hold Mode Production Path & Sustained Hold", () => {
    test("Keydown fires uIOhook -> FnHook -> HotkeyService -> main.ts handleHotkeyDown -> DictationControlCoordinator, transitioning to starting then recording", async () => {
      expect(coordinator.snapshot().state).toBe("idle");

      // Native keydown trigger (meta + shift + i)
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));

      expect(startCalls).toBe(1);
      expect(coordinator.snapshot().state).toBe("starting");

      // Acknowledge start from IPC/recorder
      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);
      expect(coordinator.snapshot().state).toBe("recording");
    });

    test("Sustained hold maintains recording state without premature stop", async () => {
      // Keydown and transition to recording
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));
      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);
      expect(coordinator.snapshot().state).toBe("recording");

      // Simulate sustained keydown auto-repeats or key holding over 600ms
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 100));
        simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      }

      expect(coordinator.snapshot().state).toBe("recording");
      expect(stopCalls.length).toBe(0);
      expect(startCalls).toBe(1);
    });

    test("Keyup reaches real callback path and transitions state to stopping", async () => {
      // Start recording
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));
      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);
      expect(coordinator.snapshot().state).toBe("recording");

      // Wait 300ms to exceed short tap threshold (>250ms press)
      await new Promise((r) => setTimeout(r, 300));

      // Native keyup trigger
      simulateKeyUp(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));

      expect(coordinator.snapshot().state).toBe("stopping");
      expect(stopCalls.length).toBe(1);
    });
  });

  describe("2. Duplicate & Racing Keyup Events", () => {
    test("Duplicate keyup events fire handleHotkeyUp multiple times, but only first keyup stops recording while subsequent keyups return action ignored", async () => {
      // Start recording and exceed short tap duration
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));
      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);
      await new Promise((r) => setTimeout(r, 300));

      // First keyup -> executes stop
      const upRes1 = await mainModule.handleHotkeyUp();
      expect(upRes1.accepted).toBe(true);
      expect(upRes1.action).toBe("stopped");
      expect(coordinator.snapshot().state).toBe("stopping");
      expect(stopCalls.length).toBe(1);

      // Second (racing/duplicate) keyup -> ignored
      const upRes2 = await mainModule.handleHotkeyUp();
      expect(upRes2.accepted).toBe(false);
      expect(upRes2.action).toBe("ignored");

      // Third duplicate keyup -> ignored
      const upRes3 = await mainModule.handleHotkeyUp();
      expect(upRes3.accepted).toBe(false);
      expect(upRes3.action).toBe("ignored");

      // Exactly ONE stop request was executed
      expect(stopCalls.length).toBe(1);
    });

    test("Duplicate keyups do not overwrite initial press timestamp or press duration", async () => {
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 150)); // 150ms press duration

      // First keyup via simulated native event records press duration (~150ms)
      simulateKeyUp(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));

      // Wait another 200ms and trigger duplicate keyup directly
      await new Promise((r) => setTimeout(r, 200));
      const upRes2 = await mainModule.handleHotkeyUp();
      expect(upRes2.accepted).toBe(false);
      expect(upRes2.action).toBe("ignored");

      // Acknowledge start now to let queued stop process
      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);

      // Assert at t=1000ms after acknowledgeStart that stop has NOT fired early (proving press duration was not overwritten)
      await new Promise((r) => setTimeout(r, 1000));
      expect(stopCalls.length).toBe(0);

      // Wait remaining timer (total 2600ms after acknowledgeStart) for short tap timer to fire
      await new Promise((r) => setTimeout(r, 1600));

      expect(stopCalls.length).toBe(1);
      expect(stopCalls[0]).toBe(true); // ensureMinimumDuration = true for short tap (<250ms press)
      expect(coordinator.snapshot().state).toBe("stopping");
    });
  });

  describe("3. Startup Keyup & Short Tap Edge Cases", () => {
    test("Keyup before acknowledgeStart queues pending stop and executes cleanly after acknowledgeStart", async () => {
      // Keydown -> starting state
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));
      expect(coordinator.snapshot().state).toBe("starting");

      // Keyup arrives BEFORE acknowledgeStart
      simulateKeyUp(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));

      expect(stopCalls.length).toBe(0);

      // acknowledgeStart completes later
      const seqId = coordinator.snapshot().sequenceId;
      const ackRes = await coordinator.acknowledgeStart(seqId, true);
      expect(ackRes.accepted).toBe(true);
      expect(ackRes.action).toBe("queued_stop");

      // Wait for minimum duration timer to complete
      await new Promise((r) => setTimeout(r, 2600));

      expect(coordinator.snapshot().state).toBe("stopping");
      expect(stopCalls.length).toBe(1);
    });

    test("Keyup after acknowledgeStart during recording state executes stop immediately for long press", async () => {
      // Keydown -> starting state -> acknowledgeStart -> recording
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));
      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);
      expect(coordinator.snapshot().state).toBe("recording");

      // Wait 300ms to exceed short tap threshold
      await new Promise((r) => setTimeout(r, 300));

      // Keyup arrives after acknowledgeStart
      const upRes = await mainModule.handleHotkeyUp();
      expect(upRes.accepted).toBe(true);
      expect(upRes.action).toBe("stopped");

      expect(coordinator.snapshot().state).toBe("stopping");
      expect(stopCalls.length).toBe(1);
    });

    test("Short-tap minimum duration timer does not execute stop if recording was cancelled or sequence ID changed", async () => {
      // Short tap keydown and immediate keyup
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 50));
      await mainModule.handleHotkeyUp();

      // Acknowledge start -> queues short tap timer
      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);
      expect(coordinator.snapshot().state).toBe("recording");

      // Explicitly cancel dictation before timer expires
      coordinator.getLifecycle().cancel();
      expect(coordinator.snapshot().state).toBe("idle");

      // Wait for timer to expire
      await new Promise((r) => setTimeout(r, 2600));

      // Stop call was NOT triggered because state was cancelled
      expect(stopCalls.length).toBe(0);
    });
  });

  describe("4. Toggle Mode Preservation", () => {
    beforeEach(async () => {
      coordinator.setDictationMode("toggle");
      await hotkeyService.stop();
      await hotkeyService.start(testBinding, mainModule.createMainHotkeyCallbacks(), undefined, "toggle");
    });

    test("Toggle Mode ignores keyup events and stops ONLY on second toggle keydown or command", async () => {
      // 1st toggle keydown -> starts recording
      simulateKeyDown(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));
      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);
      expect(coordinator.snapshot().state).toBe("recording");

      // Keyup in Toggle Mode -> ignored
      const upRes = await mainModule.handleHotkeyUp();
      expect(upRes.action).toBe("ignored");
      expect(coordinator.snapshot().state).toBe("recording");
      expect(stopCalls.length).toBe(0);

      // Keyup native event -> ignored
      simulateKeyUp(hotkeyKeycode, { metaKey: true, shiftKey: true });
      await new Promise((r) => setTimeout(r, 10));
      expect(coordinator.snapshot().state).toBe("recording");
      expect(stopCalls.length).toBe(0);

      // Wait 360ms to pass debounce window
      await new Promise((r) => setTimeout(r, 360));

      // 2nd toggle keydown -> stops recording
      const downRes2 = await mainModule.handleHotkeyDown("dictate");
      expect(downRes2.accepted).toBe(true);
      expect(downRes2.action).toBe("stopped");
      expect(coordinator.snapshot().state).toBe("stopping");
      expect(stopCalls.length).toBe(1);
    });

    test("toggleRecordingState seam starts and stops recording in Toggle Mode", async () => {
      expect(coordinator.snapshot().state).toBe("idle");

      // 1st call to toggleRecordingState -> starts recording
      const startRes = await mainModule.toggleRecordingState();
      expect(startRes.accepted).toBe(true);
      expect(startRes.action).toBe("started");
      expect(coordinator.snapshot().state).toBe("starting");

      const seqId = coordinator.snapshot().sequenceId;
      await coordinator.acknowledgeStart(seqId, true);
      expect(coordinator.snapshot().state).toBe("recording");

      await new Promise((r) => setTimeout(r, 360));

      // 2nd call to toggleRecordingState -> stops recording
      const stopRes = await mainModule.toggleRecordingState();
      expect(stopRes.accepted).toBe(true);
      expect(stopRes.action).toBe("stopped");
      expect(coordinator.snapshot().state).toBe("stopping");
      expect(stopCalls.length).toBe(1);
    });
  });
});
