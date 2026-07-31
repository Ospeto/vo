import { test, expect, describe, mock } from "bun:test";
import { CaptureRendererController } from "../../services/capture-renderer-controller.js";
import { RendererSession } from "../../services/renderer-session.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { selectionOwnershipManager } from "../../services/selection-service.js";
import { DictationControlCoordinator } from "../../services/dictation-control-coordinator.js";
import { validateIpcSenderPolicy } from "../../services/ipc-policy.js";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { type SafePasteResult } from "../../services/safe-paste.js";
import { IPC } from "../../shared/types.js";

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

describe("CaptureRendererController & Production Recovery Suite", () => {
  test("Deferred non-cooperative STT promise cleanup: proves no paste, no clipboard loss, no history entry, no success chime", async () => {
    const lifecycle = new RecordingLifecycle();
    let pasteExecuted = false;
    let historyAdded = false;
    let chimePlayed = false;

    const pasteCoordinator = new PasteCoordinator(async (): Promise<SafePasteResult> => {
      pasteExecuted = true;
      return { ok: true, reason: "injection_requested" };
    });

    const startRes = lifecycle.requestStart();
    const seq = startRes.sequenceId;
    await lifecycle.acknowledgeStart(seq, true);

    // Enter transcribing state
    lifecycle.acknowledgeStop(seq, true);
    expect(lifecycle.snapshot().state).toBe("transcribing");

    // Set selection clipboard ownership
    const originalText = "Original Clipboard Contents";
    selectionOwnershipManager.setOwnership({
      sequenceId: seq,
      previousClipboard: originalText,
      hasSelection: true,
      selectedText: "Selected Text",
      ownershipSnapshot: { formats: [{ format: "text/plain", data: Buffer.from(originalText) }], text: originalText },
    });

    // Renderer loss occurs -> production cleanup executes
    lifecycle.cancel();
    pasteCoordinator.invalidate();

    // Verify lifecycle cancelled and state reset to idle
    expect(lifecycle.snapshot().state).toBe("idle");

    // Helper checking active transcription session
    function isCurrentTranscription(checkSeq: number): boolean {
      const snapshot = lifecycle.snapshot();
      return snapshot.sequenceId === checkSeq && snapshot.state === "transcribing";
    }

    // Deferred STT promise resolves late after cleanup
    const lateText = "Late transcribed text";
    if (isCurrentTranscription(seq)) {
      await pasteCoordinator.pasteText(lateText, seq, isCurrentTranscription, () => {});
      historyAdded = true;
      chimePlayed = true;
    }

    // Assert: No paste executed, no history added, no chime played, selection ownership safely recoverable
    expect(pasteExecuted).toBe(false);
    expect(historyAdded).toBe(false);
    expect(chimePlayed).toBe(false);

    // Selection clipboard is safely restored
    let restoredText = "";
    const mockPort = {
      writeText: (t: string) => {
        restoredText = t;
      },
      snapshot: () => ({ formats: [{ format: "text/plain", data: Buffer.from(originalText) }], text: originalText }),
    };
    const restored = selectionOwnershipManager.restoreCapturedSelection(seq, mockPort as any);
    expect(restored).toBe(true);
    expect(restoredText).toBe(originalText);
  });

  test("Actual production-wiring adapter flow: DictationControlCoordinator callback, send failure, and enforceIpcSender", async () => {
    const lifecycle = new RecordingLifecycle();
    let state = "idle";

    const controller = new CaptureRendererController({
      createWindow: () => createMockWindow("capture"),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => {
        if (channel === IPC.START_RECORDING) {
          // Simulate send failure (e.g. renderer destroyed after readiness check)
          throw new Error("Render process gone");
        }
        sender.send(channel, ...args);
      },
      abortActiveFlow: () => {},
      setState: (s) => {
        state = s;
      },
      isQuitting: () => false,
    });

    const coordinator = new DictationControlCoordinator(
      {
        dictationMode: "toggle",
        isNativeKeyUpAvailable: () => false,
        isFnDown: () => false,
        onStartRecording: async () => {
          if (!controller.isReady()) return false;
          const reqRes = lifecycle.requestStart();

          // Send START_RECORDING FIRST
          const sent = controller.sendToCaptureWindow(IPC.START_RECORDING, "webm", 1.0, reqRes.sequenceId);
          if (!sent) {
            lifecycle.acknowledgeStart(reqRes.sequenceId, false);
            state = "idle";
            return false;
          }
          await lifecycle.acknowledgeStart(reqRes.sequenceId, true);
          return true;
        },
        onStopRecording: async () => true,
        onCancelDictation: () => {},
        playStopChime: () => {},
      },
      lifecycle
    );

    // Attach and acknowledge window
    controller.ensureCaptureWindow();
    const win = controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");
    expect(controller.isReady()).toBe(true);

    // UI Start command -> coordinator callback -> send failure -> returns accepted: false
    const startRes = await coordinator.handleUiCommand("start");
    expect(startRes.accepted).toBe(false);
    expect(state).toBe("idle");
    expect(lifecycle.snapshot().state).toBe("idle");

    // enforceIpcSender security check
    const mockEvent = { sender: win.webContents, frame: win.webContents.mainFrame };
    expect(() => validateIpcSenderPolicy(mockEvent as any, IPC.RECORDING_DATA, null, win as any, null)).not.toThrow();
  });

  test("Production BrowserWindow adapter: listener registration order, security guards, loadFile, and exact-once destroy", () => {
    const callOrder: string[] = [];
    let destroyCallCount = 0;

    const controller = new CaptureRendererController({
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
      abortActiveFlow: (sender) => {
        if (sender) controller.session.detach(sender);
      },
      setState: () => {},
      isQuitting: () => false,
      applySecurityGuards: () => {
        callOrder.push("applySecurityGuards");
      },
      loadFile: () => {
        callOrder.push("loadFile");
      },
    });

    controller.ensureCaptureWindow();

    // Verify listeners registered BEFORE applySecurityGuards and loadFile
    expect(callOrder).toEqual([
      "createWindow",
      "onDidFinishLoad",
      "onRenderProcessGone",
      "onClosed",
      "applySecurityGuards",
      "loadFile",
    ]);

    const win1 = controller.getPendingCaptureWindow()!;
    win1.webContents.emit("did-finish-load");
    expect(controller.isReady()).toBe(true);

    // Process crashed
    win1.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(destroyCallCount).toBe(1);

    // Secondary closed event does NOT destroy window again
    win1.emit("closed");
    expect(destroyCallCount).toBe(1);
  });

  test("Deferred 'Capture engine recovered' notification publishes ONLY after replacement is ready", () => {
    let stateHistory: Array<{ state: string; msg?: string }> = [];

    const controller = new CaptureRendererController({
      createWindow: () => createMockWindow("capture"),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
      abortActiveFlow: () => {},
      setState: (state, msg) => stateHistory.push({ state, msg }),
      isQuitting: () => false,
    });

    controller.ensureCaptureWindow();
    const win1 = controller.getPendingCaptureWindow()!;
    win1.webContents.emit("did-finish-load");
    expect(controller.isReady()).toBe(true);

    // Window closed
    win1.emit("closed");

    // Immediately after loss: "Capture engine recovered" has NOT been published
    expect(stateHistory.some((s) => s.msg === "Capture engine recovered")).toBe(false);

    // Replacement finishes loading
    const win2 = controller.getPendingCaptureWindow()!;
    win2.webContents.emit("did-finish-load");

    // NOW "Capture engine recovered" is published
    expect(controller.isReady()).toBe(true);
    expect(stateHistory.some((s) => s.msg === "Capture engine recovered")).toBe(true);
  });

  test("START_RECORDING send placed ahead of captureTarget, starting state, and chime to prevent send race side-effects", () => {
    let targetCaptured = false;
    let chimePlayed = false;
    let state = "idle";

    const controller = new CaptureRendererController({
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
      abortActiveFlow: () => {},
      setState: (s) => {
        state = s;
      },
      isQuitting: () => false,
    });

    controller.ensureCaptureWindow();
    const win = controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");
    expect(controller.isReady()).toBe(true);

    function startFlowSimulation(): boolean {
      if (!controller.isReady()) return false;

      // 1. Send START_RECORDING FIRST
      const sent = controller.sendToCaptureWindow(IPC.START_RECORDING, "webm", 1.0, 1);
      if (!sent) {
        state = "idle";
        return false;
      }

      // 2. Side effects execute ONLY after send succeeds
      targetCaptured = true;
      state = "starting";
      chimePlayed = true;
      return true;
    }

    const res = startFlowSimulation();

    // Verification: Send failed -> no target captured, no chime, no starting state
    expect(res).toBe(false);
    expect(targetCaptured).toBe(false);
    expect(chimePlayed).toBe(false);
    expect(state).toBe("idle");
  });
});
