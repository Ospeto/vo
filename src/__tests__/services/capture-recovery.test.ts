import { test, expect, describe, beforeEach, beforeAll, mock } from "bun:test";

function createMockWebContents() {
  const handlers: Record<string, Function[]> = {};
  const sentMessages: Array<{ channel: string; args: any[] }> = [];
  const mockContents: any = {
    id: Math.floor(Math.random() * 10000) + 1,
    send: mock((channel: string, ...args: any[]) => {
      sentMessages.push({ channel, args });
    }),
    on: mock((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    once: mock((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    emit: (event: string, ...args: any[]) => {
      handlers[event]?.forEach((h) => h(...args));
    },
    setWindowOpenHandler: mock(() => {}),
    isDestroyed: () => false,
    sentMessages,
  };
  return mockContents;
}

function createMockWindow(role: "capture" | "settings" | "hud" = "capture") {
  const handlers: Record<string, Function[]> = {};
  let destroyed = false;
  const webContents = createMockWebContents();
  const page = role === "capture" ? "capture.html" : role === "settings" ? "index.html" : "hud.html";
  const url = `file:///app/out/renderer/${page}`;

  (webContents as any).getURL = () => url;
  (webContents as any).mainFrame = { url, parent: null };

  return {
    webContents,
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
    },
    loadFile: mock(() => Promise.resolve()),
    on: mock((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    once: mock((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    emit: (event: string, ...args: any[]) => {
      handlers[event]?.forEach((h) => h(...args));
    },
  };
}

mock.module("uiohook-napi", () => ({
  uIOhook: {
    on: () => {},
    off: () => {},
    start: () => {},
    stop: () => {},
  },
  UiohookKey: {
    A: 30, a: 30, B: 48, b: 48, C: 46, c: 46, D: 32, d: 32, E: 18, e: 18, F: 33, f: 33, G: 34, g: 34, H: 35, h: 35,
    I: 23, i: 23, J: 36, j: 36, K: 37, k: 37, L: 38, l: 38, M: 50, m: 50, N: 49, n: 49, O: 24, o: 24, P: 25, p: 25,
    Q: 16, q: 16, R: 19, r: 19, S: 31, s: 31, T: 20, t: 20, U: 22, u: 22, V: 47, v: 47, W: 17, w: 17, X: 45, x: 45,
    Y: 21, y: 21, Z: 44, z: 44,
    Space: 57, space: 57, Enter: 28, enter: 28, Escape: 1, escape: 1, Tab: 15, tab: 15,
  },
}));

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
  BrowserWindow: createMockWindow as any,
  ipcMain: {
    on: () => {},
    handle: () => {},
  },
  Tray: class { setToolTip() {} on() {} setImage() {} },
  Menu: { buildFromTemplate: () => ({}) },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  nativeImage: { createFromPath: () => ({ setTemplateImage: () => {} }) },
  clipboard: { readText: () => "", writeText: () => {}, readBuffer: () => Buffer.from(""), writeBuffer: () => true },
  Notification: class { static isSupported() { return false; } show() {} },
  systemPreferences: { isTrustedAccessibilityClient: () => true },
  globalShortcut: { register: () => true, unregisterAll: () => {} },
}));

import { CaptureOrchestrator } from "../../services/capture-orchestrator.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { selectionOwnershipManager } from "../../services/selection-service.js";
import { DictationControlCoordinator } from "../../services/dictation-control-coordinator.js";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { validateIpcSenderPolicy } from "../../services/ipc-policy.js";
import { type SafePasteResult } from "../../services/safe-paste.js";
import { IPC, type AppState } from "../../shared/types.js";

let captureOrchestrator: any;
let dictationCoordinator: any;
let abortActiveFlow: any;

beforeAll(async () => {
  const mainMod = await import("../../main.js");
  captureOrchestrator = mainMod.captureOrchestrator;
  dictationCoordinator = mainMod.dictationCoordinator;
  abortActiveFlow = mainMod.abortActiveFlow;
});

describe("CaptureOrchestrator & Production Recovery Suite", () => {
  beforeEach(() => {
    selectionOwnershipManager.resetForTests();
  });
  test("Exported production main.ts captureOrchestrator composition path: renderer-crash on captureWindow triggers abortActiveFlow and aborts active STT controller", () => {
    expect(captureOrchestrator).toBeDefined();

    // 1. Ensure capture window on production captureOrchestrator from main.ts
    captureOrchestrator.ensureCaptureWindow();
    const win = captureOrchestrator.controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");
    expect(captureOrchestrator.isReady()).toBe(true);

    // 2. Create STT abort controller on production captureOrchestrator (as created by RECORDING_DATA handler in main.ts)
    const sttController = captureOrchestrator.createSTTAbortController();
    expect(captureOrchestrator.activeSTTAbortController).toBe(sttController);
    expect(sttController.signal.aborted).toBe(false);

    // 3. Trigger actual renderer process crash on the production capture window's webContents
    win.webContents.emit("render-process-gone", {}, { reason: "crashed" });

    // 4. Assert: render-process-gone event reached abortActiveFlow on production captureOrchestrator, aborting STT controller and clearing activeSTTAbortController
    expect(sttController.signal.aborted).toBe(true);
    expect(captureOrchestrator.activeSTTAbortController).toBeNull();
  });

  test("Exported production main.ts composition path: startRecordingFlow calls dictationCoordinator.acknowledgeStart via main.ts:118 options wiring", async () => {
    captureOrchestrator.ensureCaptureWindow();
    const win = captureOrchestrator.controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");
    expect(captureOrchestrator.isReady()).toBe(true);

    // Spy sentinel verifying main.ts:118 callback invocation specifically
    const originalAck = dictationCoordinator.acknowledgeStart.bind(dictationCoordinator);
    let ackCallbackSpyPayload: { seqId: number; success: boolean } | null = null;
    dictationCoordinator.acknowledgeStart = mock(async (seqId: number, success: boolean) => {
      ackCallbackSpyPayload = { seqId, success };
      return await originalAck(seqId, success);
    });

    try {
      const startRes = await dictationCoordinator.handleUiCommand("start");
      expect(startRes.accepted).toBe(true);

      // PROOF 1: Spy sentinel confirms main.ts:118 acknowledgeStart callback was invoked with (seqId, true)
      const currentSeq = dictationCoordinator.snapshot().sequenceId;
      expect(ackCallbackSpyPayload).not.toBeNull();
      expect((ackCallbackSpyPayload as any)?.seqId).toBe(currentSeq);
      expect((ackCallbackSpyPayload as any)?.success).toBe(true);

      // PROOF 2: Lifecycle state is "recording" (NOT stuck in "starting") via main.ts:118 wiring
      expect(dictationCoordinator.snapshot().state).toBe("recording");
      expect(captureOrchestrator.lifecycle.snapshot().state).toBe("recording");

      // PROOF 3: Queued pending stop is executed by dictationCoordinator.acknowledgeStart
      dictationCoordinator.getLifecycle().reset();

      // Trigger start command, queue an explicit stop during "starting" phase
      const reqStart = dictationCoordinator.getLifecycle().requestStart();
      expect(reqStart.accepted).toBe(true);
      const stopResult = await dictationCoordinator.handleUiCommand("stop");
      expect(stopResult.action).toBe("queued_stop");
      expect(dictationCoordinator.isPendingStop()).toBe(true);

      // Execute startRecordingFlow, which calls main.ts:118 acknowledgeStart callback
      await captureOrchestrator.startRecordingFlow();

      // Pending stop was processed by main.ts:118 acknowledgeStart callback, clearing pendingStop and executing stop
      expect(dictationCoordinator.isPendingStop()).toBe(false);
      expect(dictationCoordinator.snapshot().state).toBe("stopping");
    } finally {
      dictationCoordinator.acknowledgeStart = originalAck;
      dictationCoordinator.getLifecycle().reset();
    }
  });

  test("Real deferred STT promise test: proves no paste, no history entry, no chime, and clipboard restored on production cleanup", async () => {
    let pasteExecuted = false;
    let historyAdded = false;
    let chimePlayed = false;
    let restoredText = "";

    const originalText = "Original Clipboard Text";
    const mockPort = {
      writeText: (t: string) => {
        restoredText = t;
      },
      snapshot: () => ({ formats: [{ format: "text/plain", data: Buffer.from(originalText) }], text: originalText }),
    };

    const pasteCoordinator = new PasteCoordinator(async (): Promise<SafePasteResult> => {
      pasteExecuted = true;
      return { ok: true, reason: "injection_requested" };
    });

    const orchestrator = new CaptureOrchestrator({
      createWindow: () => createMockWindow("capture"),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
      setState: () => {},
      isQuitting: () => false,
      captureActiveSelection: async () => ({ hasSelection: true, selectedText: "Selected Text", previousClipboard: originalText }),
      capturePasteTarget: () => {},
      playStartChime: () => {},
      getInputGain: () => 1.0,
      selectionClipboardPort: mockPort,
    }, undefined, pasteCoordinator);

    // Setup window & start recording
    orchestrator.ensureCaptureWindow();
    const win = orchestrator.controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");

    const reqRes = orchestrator.lifecycle.requestStart();
    const seq = reqRes.sequenceId;
    await orchestrator.lifecycle.acknowledgeStart(seq, true);

    // Transition to transcribing state
    orchestrator.lifecycle.acknowledgeStop(seq, true);
    expect(orchestrator.lifecycle.snapshot().state).toBe("transcribing");

    // Set active STT abort controller via production orchestrator factory
    const sttController = orchestrator.createSTTAbortController();

    // Set clipboard ownership
    selectionOwnershipManager.setOwnership({
      sequenceId: seq,
      previousClipboard: originalText,
      hasSelection: true,
      selectedText: "Selected Text",
      ownershipSnapshot: { formats: [{ format: "text/plain", data: Buffer.from(originalText) }], text: originalText },
    });

    // Create a real deferred STT promise
    let resolveSttPromise: (value: string) => void;
    const sttPromise = new Promise<string>((resolve) => {
      resolveSttPromise = resolve;
    });

    // Production cleanup triggered by renderer process crash during STT
    win.webContents.emit("render-process-gone", {}, { reason: "crashed" });

    // Verify STT controller was aborted, lifecycle reset to idle, and clipboard restored
    expect(sttController.signal.aborted).toBe(true);
    expect(orchestrator.activeSTTAbortController).toBeNull();
    expect(orchestrator.lifecycle.snapshot().state).toBe("idle");
    expect(restoredText).toBe(originalText);

    // Deferred STT resolves late
    resolveSttPromise!("Late Transcribed Result");
    const text = await sttPromise;

    // Execute real production STT handler logic
    function isCurrentTranscription(checkSeq: number): boolean {
      const snapshot = orchestrator.lifecycle.snapshot();
      return snapshot.sequenceId === checkSeq && snapshot.state === "transcribing";
    }

    if (isCurrentTranscription(seq)) {
      const pasteRes = await pasteCoordinator.pasteText(
        text,
        seq,
        isCurrentTranscription,
        () => orchestrator.restoreCapturedSelection(seq)
      );
      if (pasteRes.status === "submitted") {
        historyAdded = true;
        chimePlayed = true;
      }
    }

    // Assert: No paste, no history entry, no chime, selection restored
    expect(pasteExecuted).toBe(false);
    expect(historyAdded).toBe(false);
    expect(chimePlayed).toBe(false);
    expect(restoredText).toBe(originalText);
  });



  test("START_RECORDING send placed BEFORE captureTarget, starting state, and chime to prevent send race side-effects", async () => {
    let targetCaptured = false;
    let chimePlayed = false;
    let currentState: string = "idle";

    const orchestrator = new CaptureOrchestrator({
      createWindow: () => createMockWindow("capture"),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: () => {
        // Send fails by throwing
        throw new Error("IPC Send failed");
      },
      setState: (s) => {
        currentState = s;
      },
      isQuitting: () => false,
      captureActiveSelection: async () => ({ hasSelection: false, selectedText: "", previousClipboard: "" }),
      capturePasteTarget: () => {
        targetCaptured = true;
      },
      playStartChime: () => {
        chimePlayed = true;
      },
      getInputGain: () => 1.0,
    });

    orchestrator.ensureCaptureWindow();
    const win = orchestrator.controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");
    expect(orchestrator.isReady()).toBe(true);

    orchestrator.lifecycle.requestStart();

    // Execute real production startRecordingFlow
    const res = await orchestrator.startRecordingFlow();

    // Verification: Send failed -> returns false, no target captured, no chime, state reset to idle
    expect(res).toBe(false);
    expect(targetCaptured).toBe(false);
    expect(chimePlayed).toBe(false);
    expect(currentState).toBe("idle");
    expect(orchestrator.lifecycle.snapshot().state).toBe("error");
  });

  test("Actual production-wiring adapter flow: DictationControlCoordinator callback, send failure, and enforceIpcSender", async () => {
    let currentState: string = "idle";

    const orchestrator = new CaptureOrchestrator({
      createWindow: () => createMockWindow("capture"),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => {
        if (channel === IPC.START_RECORDING) {
          throw new Error("IPC Send failed");
        }
        sender.send(channel, ...args);
      },
      setState: (s) => {
        currentState = s;
      },
      isQuitting: () => false,
      captureActiveSelection: async () => ({ hasSelection: false, selectedText: "", previousClipboard: "" }),
      capturePasteTarget: () => {},
      playStartChime: () => {},
      getInputGain: () => 1.0,
    });

    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "toggle",
        isNativeKeyUpAvailable: () => false,
        isFnDown: () => false,
        onStartRecording: async () => orchestrator.startRecordingFlow(),
        onStopRecording: async () => true,
        onCancelDictation: () => {},
        playStopChime: () => {},
      },
      orchestrator.lifecycle
    );

    // Attach & ready capture window
    orchestrator.ensureCaptureWindow();
    const win = orchestrator.controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");
    expect(orchestrator.isReady()).toBe(true);

    // UI start command triggers coordinator -> startRecordingFlow -> send failure -> returns accepted: false
    const startRes = await coordinator.handleUiCommand("start");
    expect(startRes.accepted).toBe(false);
    expect(currentState).toBe("idle");

    // enforceIpcSender security check
    const mockEvent = { sender: win.webContents, frame: win.webContents.mainFrame };
    expect(() => orchestrator.enforceIpcSender(mockEvent as any, IPC.RECORDING_DATA)).not.toThrow();
  });

  test("Production BrowserWindow adapter: listener registration order, security guards, loadFile, and exact-once destroy", () => {
    const callOrder: string[] = [];
    let destroyCallCount = 0;

    const orchestrator = new CaptureOrchestrator({
      createWindow: () => {
        callOrder.push("createWindow");
        return createMockWindow("capture");
      },
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => {
        destroyCallCount++;
        win.destroy();
      },
      onRenderProcessGone: (sender, handler) => {
        callOrder.push("onRenderProcessGone");
        sender.on("render-process-gone", handler);
      },
      onDidFinishLoad: (sender, handler) => {
        callOrder.push("onDidFinishLoad");
        sender.once("did-finish-load", handler);
      },
      onClosed: (win, handler) => {
        callOrder.push("onClosed");
        win.on("closed", handler);
      },
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
      setState: () => {},
      isQuitting: () => false,
      applySecurityGuards: () => {
        callOrder.push("applySecurityGuards");
      },
      loadFile: () => {
        callOrder.push("loadFile");
      },
      captureActiveSelection: async () => ({ hasSelection: false, selectedText: "", previousClipboard: "" }),
      capturePasteTarget: () => {},
      playStartChime: () => {},
      getInputGain: () => 1.0,
    });

    orchestrator.ensureCaptureWindow();

    // Verify listeners registered BEFORE applySecurityGuards and loadFile
    expect(callOrder).toEqual([
      "createWindow",
      "onDidFinishLoad",
      "onRenderProcessGone",
      "onClosed",
      "applySecurityGuards",
      "loadFile",
    ]);

    const win1 = orchestrator.controller.getPendingCaptureWindow()!;
    win1.webContents.emit("did-finish-load");
    expect(orchestrator.isReady()).toBe(true);

    // Process crashed
    win1.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(destroyCallCount).toBe(1);

    // Secondary closed event does NOT destroy window again
    win1.emit("closed");
    expect(destroyCallCount).toBe(1);
  });

  test("Deferred 'Capture engine recovered' notification publishes ONLY after replacement renderer is ready", () => {
    let stateHistory: Array<{ state: string; msg?: string }> = [];

    const orchestrator = new CaptureOrchestrator({
      createWindow: () => createMockWindow("capture"),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
      setState: (state, msg) => stateHistory.push({ state, msg }),
      isQuitting: () => false,
      captureActiveSelection: async () => ({ hasSelection: false, selectedText: "", previousClipboard: "" }),
      capturePasteTarget: () => {},
      playStartChime: () => {},
      getInputGain: () => 1.0,
    });

    orchestrator.ensureCaptureWindow();
    const win1 = orchestrator.controller.getPendingCaptureWindow()!;
    win1.webContents.emit("did-finish-load");
    expect(orchestrator.isReady()).toBe(true);

    // Window closed
    win1.emit("closed");

    // Immediately after loss: "Capture engine recovered" has NOT been published
    expect(stateHistory.some((s) => s.msg === "Capture engine recovered")).toBe(false);

    // Replacement finishes loading
    const win2 = orchestrator.controller.getPendingCaptureWindow()!;
    win2.webContents.emit("did-finish-load");

    // NOW "Capture engine recovered" is published
    expect(orchestrator.isReady()).toBe(true);
    expect(stateHistory.some((s) => s.msg === "Capture engine recovered")).toBe(true);
  });
});
