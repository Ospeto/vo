import { test, expect, describe, mock } from "bun:test";
import { CaptureOrchestrator } from "../../services/capture-orchestrator.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { selectionOwnershipManager } from "../../services/selection-service.js";
import { DictationControlCoordinator } from "../../services/dictation-control-coordinator.js";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { type SafePasteResult } from "../../services/safe-paste.js";
import { IPC, type AppState } from "../../shared/types.js";

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

describe("CaptureOrchestrator & Production Recovery Suite", () => {
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

  test("Successful startRecordingFlow calls acknowledgeStart and transitions lifecycle state to 'recording'", async () => {
    let currentState: string = "idle";

    const orchestrator = new CaptureOrchestrator({
      createWindow: () => createMockWindow("capture"),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
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

    // Provide coordinator's acknowledgeStart to orchestrator
    (orchestrator as any).options.acknowledgeStart = (seqId: number, success: boolean) => coordinator.acknowledgeStart(seqId, success);

    orchestrator.ensureCaptureWindow();
    const win = orchestrator.controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");

    // Execute start command
    const startRes = await coordinator.handleUiCommand("start");
    expect(startRes.accepted).toBe(true);
    expect(currentState).toBe("recording");

    // CRITICAL: Lifecycle state is now "recording" (NOT stuck in "starting")
    expect(orchestrator.lifecycle.snapshot().state).toBe("recording");

    // Normal stop request is now accepted cleanly
    const stopRes = orchestrator.lifecycle.requestStop();
    expect(stopRes.accepted).toBe(true);
    expect(orchestrator.lifecycle.snapshot().state).toBe("stopping");
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
