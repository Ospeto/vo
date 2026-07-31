import { test, expect, describe, mock } from "bun:test";
import { CaptureRendererController } from "../../services/capture-renderer-controller.js";
import { RendererSession } from "../../services/renderer-session.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { selectionOwnershipManager } from "../../services/selection-service.js";
import { IPC } from "../../shared/types.js";

function createMockWebContents() {
  const handlers: Record<string, Function[]> = {};
  const sentMessages: Array<{ channel: string; args: any[] }> = [];
  return {
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
}

function createMockWindow() {
  const handlers: Record<string, Function[]> = {};
  let destroyed = false;
  const webContents = createMockWebContents();
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
  test("Closed-without-crash recovers capture window cleanly using CaptureRendererController", () => {
    const lifecycle = new RecordingLifecycle();
    let createdCount = 0;
    let abortCount = 0;
    let stateHistory: Array<{ state: string; msg?: string }> = [];

    const controller = new CaptureRendererController({
      createWindow: () => {
        createdCount++;
        return createMockWindow();
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

    // 1. Initial creation
    controller.ensureCaptureWindow();
    expect(createdCount).toBe(1);
    expect(controller.getPendingCaptureWindow()).not.toBeNull();
    expect(controller.getCaptureWindow()).toBeNull();
    expect(controller.isReady()).toBe(false);

    // Acknowledge ready
    const win1 = controller.getPendingCaptureWindow()!;
    win1.webContents.emit("did-finish-load");
    expect(controller.getCaptureWindow()).toBe(win1);
    expect(controller.getPendingCaptureWindow()).toBeNull();
    expect(controller.isReady()).toBe(true);

    // 2. Start recording
    lifecycle.requestStart();
    expect(lifecycle.snapshot().state).toBe("starting");

    // 3. Emit closed WITHOUT render-process-gone on win1
    win1.emit("closed");

    // Verify recovery triggered
    expect(abortCount).toBe(1);
    expect(lifecycle.snapshot().state).toBe("idle");
    expect(stateHistory.some((s) => s.msg === "Capture engine recovered")).toBe(true);
    expect(createdCount).toBe(2);

    // New window ready
    const win2 = controller.getPendingCaptureWindow()!;
    win2.webContents.emit("did-finish-load");
    expect(controller.getCaptureWindow()).toBe(win2);
    expect(controller.isReady()).toBe(true);
  });

  test("Identity gate prevents duplicate/stale loss events from affecting newer lifecycle or clipboard", () => {
    const lifecycle = new RecordingLifecycle();
    let createdCount = 0;
    let abortCount = 0;

    const controller = new CaptureRendererController({
      createWindow: () => {
        createdCount++;
        return createMockWindow();
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
      setState: () => {},
      isQuitting: () => false,
    });

    controller.ensureCaptureWindow();
    const win1 = controller.getPendingCaptureWindow()!;
    win1.webContents.emit("did-finish-load");
    expect(controller.getCaptureWindow()).toBe(win1);

    // Crash win1 -> recovers win2
    win1.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(abortCount).toBe(1);
    expect(createdCount).toBe(2);

    const win2 = controller.getPendingCaptureWindow()!;
    win2.webContents.emit("did-finish-load");
    expect(controller.getCaptureWindow()).toBe(win2);
    expect(controller.isReady()).toBe(true);

    // Sequence 2 starts on win2
    lifecycle.requestStart();
    expect(lifecycle.snapshot().state).toBe("starting");

    // NOW late duplicate render-process-gone AND closed events arrive for win1
    win1.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    win1.emit("closed");

    // Identity check blocked global cleanup, preserved sequence 2, and did not create win3
    expect(abortCount).toBe(1); // abortCount stayed 1!
    expect(createdCount).toBe(2); // createdCount stayed 2!
    expect(controller.getCaptureWindow()).toBe(win2);
    expect(lifecycle.snapshot().state).toBe("starting");
    expect(controller.isReady()).toBe(true);
  });

  test("Pre-readiness start returns failure when no ready capture renderer exists", () => {
    const lifecycle = new RecordingLifecycle();
    let stateChanged = false;

    const controller = new CaptureRendererController({
      createWindow: () => createMockWindow(),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
      abortActiveFlow: () => {},
      setState: (state) => {
        if (state === "idle") stateChanged = true;
      },
      isQuitting: () => false,
    });

    // Window created but NOT acknowledged ready yet
    controller.ensureCaptureWindow();
    expect(controller.isReady()).toBe(false);

    // Simulate start flow
    const reqRes = lifecycle.requestStart();
    expect(reqRes.accepted).toBe(true);

    function startFlowSimulation(): boolean {
      if (!controller.isReady()) {
        lifecycle.acknowledgeStart(reqRes.sequenceId, false);
        stateChanged = true;
        return false;
      }
      return true;
    }

    const res = startFlowSimulation();
    expect(res).toBe(false);
    expect(stateChanged).toBe(true);
    expect(lifecycle.snapshot().state).toBe("error");
  });

  test("Destroyed-window send handling guards against IPC emission", () => {
    const controller = new CaptureRendererController({
      createWindow: () => createMockWindow(),
      getWebContents: (win) => win.webContents,
      isDestroyed: (win) => win.isDestroyed(),
      destroyWindow: (win) => win.destroy(),
      onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
      onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
      onClosed: (win, handler) => win.on("closed", handler),
      sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
      abortActiveFlow: () => {},
      setState: () => {},
      isQuitting: () => false,
    });

    controller.ensureCaptureWindow();
    const win = controller.getPendingCaptureWindow()!;
    win.webContents.emit("did-finish-load");
    expect(controller.isReady()).toBe(true);

    // Now win is destroyed
    win.destroy();

    // Sending IPC should return false cleanly without throwing
    const sendRes = controller.sendToCaptureWindow(IPC.STATE_CHANGED, { state: "recording" });
    expect(sendRes).toBe(false);
  });

  test("Non-cooperative STT error and clipboard ownership remediation", () => {
    const seqId = 999;
    const testText = "Original Clipboard Contents";

    // Set ownership
    selectionOwnershipManager.setOwnership({
      sequenceId: seqId,
      previousClipboard: testText,
      hasSelection: true,
      selectedText: "Selected Text",
      ownershipSnapshot: { formats: [{ format: "text/plain", data: Buffer.from(testText) }], text: testText },
    });

    // Mock clipboard port
    let restoredText = "";
    const mockPort = {
      writeText: (t: string) => {
        restoredText = t;
      },
      snapshot: () => ({ formats: [{ format: "text/plain", data: Buffer.from(testText) }], text: testText }),
    };

    // Non-cooperative STT failure happens -> restore selection
    const restored = selectionOwnershipManager.restoreCapturedSelection(seqId, mockPort as any);

    expect(restored).toBe(true);
    expect(restoredText).toBe(testText);

    // Ownership cleared
    selectionOwnershipManager.clearOwnership(seqId);
    expect(selectionOwnershipManager.restoreCapturedSelection(seqId, mockPort as any)).toBe(false);
  });
});
