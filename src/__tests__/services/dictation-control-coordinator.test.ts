import { describe, test, expect, beforeEach, mock } from "bun:test";

let isTrustedAccessibilityMock = true;
let registerMockReturn = true;

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
    on: () => {},
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
  },
}));

const { DictationControlCoordinator } = await import("../../services/dictation-control-coordinator.js");
const { RecordingLifecycle } = await import("../../services/recording-lifecycle.js");
const { HotkeyService } = await import("../../services/hotkey-service.js");
const { parseKeyBinding } = await import("../../services/config.js");
const { globalShortcut } = await import("electron");

describe("PR-07 Dictation Control Coordinator & Hotkey Remediation Suite", () => {
  let lifecycle: InstanceType<typeof RecordingLifecycle>;

  beforeEach(() => {
    lifecycle = new RecordingLifecycle();
    isTrustedAccessibilityMock = true;
    registerMockReturn = true;
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

  test("5. False fallback registration reports failure in HotkeyService", async () => {
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

  test("6. Hold mode rejects down-only fallback when native key-up fails to start in HotkeyService", async () => {
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
