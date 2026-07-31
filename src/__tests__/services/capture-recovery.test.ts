import { test, expect, describe, mock } from "bun:test";
import { RendererSession } from "../../services/renderer-session.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
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

describe("Capture Recovery Orchestration & Production Session Rules", () => {
  test("Closed-without-crash recovers capture window cleanly", () => {
    const lifecycle = new RecordingLifecycle();
    const session = new RendererSession<any>();

    let captureWindow: any = null;
    let pendingCaptureWindow: any = null;
    let createdCount = 0;
    let isQuitting = false;

    function abortActiveFlow(sender: any) {
      lifecycle.cancel();
      if (sender) {
        session.detach(sender);
      }
    }

    function ensureCaptureWindow() {
      if (captureWindow || pendingCaptureWindow || isQuitting) return;
      createdCount++;
      const win = createMockWindow();
      pendingCaptureWindow = win;

      const sender = win.webContents;
      const gen = session.attach(sender);

      sender.once("did-finish-load", () => {
        if (win.isDestroyed()) return;
        if (!session.acknowledgeReady(sender, gen)) return;
        captureWindow = win;
        pendingCaptureWindow = null;
      });

      sender.on("render-process-gone", () => {
        if (captureWindow === win) captureWindow = null;
        if (pendingCaptureWindow === win) pendingCaptureWindow = null;
        abortActiveFlow(sender);
        if (!win.isDestroyed()) win.destroy();
        if (!isQuitting) ensureCaptureWindow();
      });

      win.on("closed", () => {
        if (captureWindow !== win && pendingCaptureWindow !== win) return;
        if (captureWindow === win) captureWindow = null;
        if (pendingCaptureWindow === win) pendingCaptureWindow = null;
        abortActiveFlow(sender);
        if (!isQuitting) ensureCaptureWindow();
      });
    }

    // 1. Initial creation
    ensureCaptureWindow();
    expect(createdCount).toBe(1);
    expect(pendingCaptureWindow).not.toBeNull();
    expect(captureWindow).toBeNull();

    // Acknowledge ready
    pendingCaptureWindow.webContents.emit("did-finish-load");
    expect(captureWindow).not.toBeNull();
    expect(pendingCaptureWindow).toBeNull();
    const firstSender = captureWindow.webContents;
    expect(session.isAvailable(firstSender)).toBe(true);

    // 2. Start recording
    lifecycle.requestStart();
    expect(lifecycle.snapshot().state).toBe("starting");

    // 3. Emit closed WITHOUT render-process-gone
    const winToClose = captureWindow;
    winToClose.emit("closed");

    // Lifecycle cancelled, old session detached
    expect(lifecycle.snapshot().state).toBe("idle");
    expect(session.isAvailable(firstSender)).toBe(false);

    // Replacement created
    expect(createdCount).toBe(2);
    expect(pendingCaptureWindow).not.toBeNull();

    // Replacement becomes ready
    const replacementWin = pendingCaptureWindow;
    replacementWin.webContents.emit("did-finish-load");
    expect(captureWindow).toBe(replacementWin);
    expect(session.isAvailable(replacementWin.webContents)).toBe(true);
  });

  test("Stale closed event does not clear replacement window or trigger double-recovery", () => {
    const session = new RendererSession<any>();
    let captureWindow: any = null;
    let pendingCaptureWindow: any = null;
    let createdCount = 0;

    function ensureCaptureWindow() {
      if (captureWindow || pendingCaptureWindow) return;
      createdCount++;
      const win = createMockWindow();
      pendingCaptureWindow = win;
      const sender = win.webContents;
      const gen = session.attach(sender);

      sender.once("did-finish-load", () => {
        if (win.isDestroyed()) return;
        if (!session.acknowledgeReady(sender, gen)) return;
        captureWindow = win;
        pendingCaptureWindow = null;
      });

      sender.on("render-process-gone", () => {
        if (captureWindow === win) captureWindow = null;
        if (pendingCaptureWindow === win) pendingCaptureWindow = null;
        session.detach(sender);
        if (!win.isDestroyed()) win.destroy();
        ensureCaptureWindow();
      });

      win.on("closed", () => {
        if (captureWindow !== win && pendingCaptureWindow !== win) return;
        if (captureWindow === win) captureWindow = null;
        if (pendingCaptureWindow === win) pendingCaptureWindow = null;
        session.detach(sender);
        ensureCaptureWindow();
      });
    }

    ensureCaptureWindow();
    const oldWin = pendingCaptureWindow;
    oldWin.webContents.emit("did-finish-load");
    expect(captureWindow).toBe(oldWin);

    // Old window crashes -> process-gone triggers recovery
    oldWin.webContents.emit("render-process-gone");
    expect(createdCount).toBe(2);
    const replacementWin = pendingCaptureWindow;
    replacementWin.webContents.emit("did-finish-load");
    expect(captureWindow).toBe(replacementWin);

    // Now old window emits closed delayed
    oldWin.emit("closed");

    // Exact instance check prevents clearing replacement window
    expect(captureWindow).toBe(replacementWin);
    expect(createdCount).toBe(2);
  });

  test("Stale cancellation race protection prevents cancelling newer session on replacement window", async () => {
    const lifecycle = new RecordingLifecycle();
    const session = new RendererSession<any>();

    let captureWindow: any = null;

    function sendToCaptureWindow(channel: string, ...args: any[]) {
      if (captureWindow && session.isAvailable(captureWindow.webContents)) {
        captureWindow.webContents.send(channel, ...args);
      }
    }

    // Win 1
    const win1 = createMockWindow();
    session.attach(win1.webContents);
    session.acknowledgeReady(win1.webContents, 1);
    captureWindow = win1;

    // Start flow for sequence 1
    const start1 = lifecycle.requestStart();
    const seq1 = start1.sequenceId;
    let targetSender1 = captureWindow.webContents;

    // Win 1 crashes during async selection capture
    session.detach(win1.webContents);

    // Replacement Win 2 is attached and ready
    const win2 = createMockWindow();
    const gen2 = session.attach(win2.webContents);
    session.acknowledgeReady(win2.webContents, gen2);
    captureWindow = win2;

    // Sequence 2 starts on win 2
    lifecycle.cancel(); // seq 1 cancelled/reset
    const start2 = lifecycle.requestStart();
    const seq2 = start2.sequenceId;
    sendToCaptureWindow(IPC.START_RECORDING, "webm", 1.0, seq2);

    // Now async selection capture for seq 1 finishes (stale)
    const lifecycleSnapshot = lifecycle.snapshot();
    if (
      lifecycleSnapshot.sequenceId === seq1 &&
      captureWindow &&
      captureWindow.webContents === targetSender1 &&
      session.isAvailable(targetSender1)
    ) {
      sendToCaptureWindow(IPC.CANCEL_RECORDING);
    }

    // Win 2 should NOT receive CANCEL_RECORDING from seq 1!
    const win2Messages = win2.webContents.sentMessages;
    expect(win2Messages.some((m) => m.channel === IPC.CANCEL_RECORDING)).toBe(false);
    expect(win2Messages.some((m) => m.channel === IPC.START_RECORDING && m.args[2] === seq2)).toBe(true);
  });

  test("Session-bound IPC routing rejects sends when sender is unavailable", () => {
    const session = new RendererSession<any>();
    let captureWindow: any = null;
    const sent: Array<{ channel: string; args: any[] }> = [];

    function sendToCaptureWindow(channel: string, ...args: any[]) {
      if (captureWindow && session.isAvailable(captureWindow.webContents)) {
        captureWindow.webContents.send(channel, ...args);
        sent.push({ channel, args });
      }
    }

    const win = createMockWindow();
    captureWindow = win;

    // Attached but not acknowledged ready
    session.attach(win.webContents);
    sendToCaptureWindow(IPC.STATE_CHANGED, { state: "recording" });
    sendToCaptureWindow(IPC.GAIN_UPDATE, 1.5);
    expect(sent.length).toBe(0);

    // Acknowledged ready
    session.acknowledgeReady(win.webContents, 1);
    sendToCaptureWindow(IPC.STATE_CHANGED, { state: "recording" });
    sendToCaptureWindow(IPC.GAIN_UPDATE, 1.5);
    expect(sent.length).toBe(2);

    // Detached
    session.detach(win.webContents);
    sendToCaptureWindow(IPC.CANCEL_RECORDING);
    expect(sent.length).toBe(2); // no new message sent
  });

  test("Next-start success after capture recovery", () => {
    const lifecycle = new RecordingLifecycle();
    const session = new RendererSession<any>();
    let captureWindow: any = null;

    const win = createMockWindow();
    session.attach(win.webContents);
    session.acknowledgeReady(win.webContents, 1);
    captureWindow = win;

    // Fail attempt 1 due to crash
    lifecycle.requestStart();
    session.detach(win.webContents);
    lifecycle.cancel();

    // Recover with win2
    const win2 = createMockWindow();
    const gen2 = session.attach(win2.webContents);
    session.acknowledgeReady(win2.webContents, gen2);
    captureWindow = win2;

    // Attempt 2 succeeds
    const start2 = lifecycle.requestStart();
    expect(start2.accepted).toBe(true);
    expect(lifecycle.snapshot().state).toBe("starting");
    expect(session.isAvailable(captureWindow.webContents)).toBe(true);
  });
});
