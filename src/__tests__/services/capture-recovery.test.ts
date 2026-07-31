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
  test("Closed-without-crash publishes 'Capture engine recovered' ONLY after replacement is ready", () => {
    const lifecycle = new RecordingLifecycle();
    let createdCount = 0;
    let abortCount = 0;
    let stateHistory: Array<{ state: string; msg?: string }> = [];

    const controller = new CaptureRendererController({
      createWindow: () => {
        createdCount++;
        return createMockWindow("capture");
      },
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
      abortActiveFlow: (sender) => {
        abortCount++;
        lifecycle.cancel();
        if (sender) controller.session.detach(sender);
      },
      setState: (state, msg) => stateHistory.push({ state, msg }),
      isQuitting: () => false,
    });

    // 1. Initial creation & readiness
    controller.ensureCaptureWindow();
    const win1 = controller.getPendingCaptureWindow()!;
    win1.webContents.emit("did-finish-load");
    expect(controller.isReady()).toBe(true);

    // 2. Closed event fires on win1
    win1.emit("closed");

    // Immediately after loss: state history does NOT contain "Capture engine recovered" yet!
    expect(stateHistory.some((s) => s.msg === "Capture engine recovered")).toBe(false);
    expect(controller.isReady()).toBe(false);
    expect(createdCount).toBe(2);

    // 3. Replacement window emits did-finish-load
    const win2 = controller.getPendingCaptureWindow()!;
    win2.webContents.emit("did-finish-load");

    // NOW "Capture engine recovered" is published!
    expect(controller.isReady()).toBe(true);
    expect(stateHistory.some((s) => s.msg === "Capture engine recovered")).toBe(true);
  });

  test("Propagates false from sendToCaptureWindow when renderer destroyed after readiness check", async () => {
    const lifecycle = new RecordingLifecycle();
    const pasteCoordinator = new PasteCoordinator(async (): Promise<SafePasteResult> => ({ ok: true, reason: "injection_requested" }));
    let state: string = "idle";
    let message: string | undefined;

    const controller = new CaptureRendererController({
      createWindow: () => createMockWindow("capture"),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => {
        // Simulate window destruction during send
        throw new Error("Render process gone");
      },
      abortActiveFlow: () => {},
      setState: (s, m) => {
        state = s;
        message = m;
      },
      isQuitting: () => false,
    });

    controller.ensureCaptureWindow();
    const win = controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");
    expect(controller.isReady()).toBe(true);

    // Attempt start flow
    const reqRes = lifecycle.requestStart();
    expect(reqRes.accepted).toBe(true);

    async function startFlowSimulation(): Promise<boolean> {
      if (!controller.isReady()) {
        lifecycle.acknowledgeStart(reqRes.sequenceId, false);
        return false;
      }

      pasteCoordinator.invalidate();
      state = "starting";

      const sent = controller.sendToCaptureWindow(IPC.START_RECORDING, "webm", 1.0, reqRes.sequenceId);
      if (!sent) {
        pasteCoordinator.invalidate();
        lifecycle.acknowledgeStart(reqRes.sequenceId, false);
        state = "idle";
        message = "Capture engine not ready";
        return false;
      }

      state = "recording";
      await lifecycle.acknowledgeStart(reqRes.sequenceId, true);
      return true;
    }

    const res = await startFlowSimulation();

    // Propagated false, did NOT enter recording state, acknowledged start as false
    expect(res).toBe(false);
    expect(state).toBe("idle");
    expect(message).toBe("Capture engine not ready");
    expect(lifecycle.snapshot().state).toBe("error");
  });

  test("Production-wiring adapter integration: DictationControlCoordinator, enforceIpcSender, and send path", async () => {
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
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
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
          const sent = controller.sendToCaptureWindow(IPC.START_RECORDING);
          return sent;
        },
        onStopRecording: async () => true,
        onCancelDictation: () => {},
        playStopChime: () => {},
      },
      lifecycle
    );

    // Unready start fails through coordinator
    const res1 = await coordinator.handleUiCommand("start");
    expect(res1.accepted).toBe(false);

    // Ready start succeeds through coordinator & send path
    controller.ensureCaptureWindow();
    const win = controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");

    const res2 = await coordinator.handleUiCommand("start");
    expect(res2.accepted).toBe(true);
    expect(win.webContents.sentMessages.some((m: any) => m.channel === IPC.START_RECORDING)).toBe(true);

    // enforceIpcSender security check
    const mockEvent = { sender: win.webContents, frame: win.webContents.mainFrame };
    expect(() => validateIpcSenderPolicy(mockEvent as any, IPC.RECORDING_DATA, null, win as any, null)).not.toThrow();
  });

  test("Deferred non-cooperative STT & late paste race coverage through production cleanup", async () => {
    const lifecycle = new RecordingLifecycle();
    const pasteCoordinator = new PasteCoordinator(async (): Promise<SafePasteResult> => ({ ok: true, reason: "injection_requested" }));

    const startRes = lifecycle.requestStart();
    const seq = startRes.sequenceId;
    await lifecycle.acknowledgeStart(seq, true);

    // Set active selection
    selectionOwnershipManager.setOwnership({
      sequenceId: seq,
      previousClipboard: "Original text",
      hasSelection: true,
      selectedText: "Selected text",
      ownershipSnapshot: { formats: [{ format: "text/plain", data: Buffer.from("Original text") }], text: "Original text" },
    });

    // User cancels dictation while STT is pending
    lifecycle.cancel();
    pasteCoordinator.invalidate();

    function isCurrentTranscription(checkSeq: number): boolean {
      const snapshot = lifecycle.snapshot();
      return snapshot.sequenceId === checkSeq && snapshot.state === "transcribing";
    }

    // Deferred STT finishes late with transcript
    const lateText = "Late transcribed text";
    const pasteRes = await pasteCoordinator.pasteText(
      lateText,
      seq,
      isCurrentTranscription,
      () => selectionOwnershipManager.restoreCapturedSelection(seq, { writeText: () => {}, snapshot: () => null } as any)
    );

    // Paste coordinator rejected stale paste result
    expect(pasteRes.status).toBe("stale");
    expect(lifecycle.snapshot().state).toBe("idle");
  });

  test("Observed production BrowserWindow destruction exact-once recovery", () => {
    let destroyCallCount = 0;
    let createdCount = 0;

    const controller = new CaptureRendererController({
      createWindow: () => {
        createdCount++;
        return createMockWindow("capture");
      },
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => {
        destroyCallCount++;
        win.destroy();
      },
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
      abortActiveFlow: (sender) => {
        if (sender) controller.session.detach(sender);
      },
      setState: () => {},
      isQuitting: () => false,
    });

    controller.ensureCaptureWindow();
    const win1 = controller.getPendingCaptureWindow()!;
    win1.webContents.emit("did-finish-load");

    // Process crashed
    win1.webContents.emit("render-process-gone", {}, { reason: "crashed" });

    // Destroy called exactly once
    expect(destroyCallCount).toBe(1);
    expect(createdCount).toBe(2);

    // Subsequent closed event on destroyed win1 does NOT trigger second destroy or third window
    win1.emit("closed");
    expect(destroyCallCount).toBe(1);
    expect(createdCount).toBe(2);
  });
});
