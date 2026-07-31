import { CaptureRendererController } from "./capture-renderer-controller.js";
import { RecordingLifecycle } from "./recording-lifecycle.js";
import { PasteCoordinator } from "./paste-flow.js";
import { selectionOwnershipManager } from "./selection-service.js";
import { RendererSession } from "./renderer-session.js";
import { validateIpcSenderPolicy } from "./ipc-policy.js";
import { IPC, type AppState, type RendererRole } from "../shared/types.js";
import logger from "./logger.js";

export interface CaptureOrchestratorOptions<TWindow = any, TSender = any> {
  createWindow: () => TWindow;
  getWebContents: (win: TWindow) => TSender;
  isDestroyed: (win: TWindow) => boolean;
  destroyWindow: (win: TWindow) => void;
  onRenderProcessGone: (sender: TSender, handler: (event: any, details: any) => void) => void;
  onDidFinishLoad: (sender: TSender, handler: () => void) => void;
  onClosed: (win: TWindow, handler: () => void) => void;
  sendIpc: (sender: TSender, channel: string, ...args: any[]) => void;
  setState: (state: AppState, message?: string, options?: any) => void;
  isQuitting: () => boolean;
  applySecurityGuards?: (win: TWindow) => void;
  loadFile?: (win: TWindow) => void;
  captureActiveSelection: (timeoutMs: number, options: any) => Promise<{ hasSelection: boolean; selectedText: string; previousClipboard: string | any }>;
  capturePasteTarget: () => void;
  playStartChime: () => void;
  getInputGain: () => number;
  selectionClipboardPort?: any;
  getPopoverWindow?: () => TWindow | null;
  getHudWindow?: () => TWindow | null;
  acknowledgeStart?: (seqId: number, success: boolean) => Promise<any> | any;
}

export class CaptureOrchestrator<TWindow = any, TSender = any> {
  public controller: CaptureRendererController<TSender, TWindow>;
  public lifecycle: RecordingLifecycle;
  public pasteCoordinator: PasteCoordinator;
  public activeSelectionAbortController: AbortController | null = null;
  public activeSTTAbortController: AbortController | null = null;
  public activeSelectionText = "";
  public currentTriggerMode: "dictate" | "edit" = "dictate";
  private options: CaptureOrchestratorOptions<TWindow, TSender>;
  private captureActive = false;
  private activeCaptureSequenceId: number | null = null;

  constructor(
    options: CaptureOrchestratorOptions<TWindow, TSender>,
    lifecycle?: RecordingLifecycle,
    pasteCoordinator?: PasteCoordinator
  ) {
    this.options = options;
    this.lifecycle = lifecycle ?? new RecordingLifecycle();
    this.pasteCoordinator = pasteCoordinator ?? new PasteCoordinator(async () => ({ ok: true, reason: "injection_requested" }));

    this.controller = new CaptureRendererController<TSender, TWindow>({
      createWindow: options.createWindow,
      getWebContents: options.getWebContents,
      isDestroyed: options.isDestroyed,
      destroyWindow: options.destroyWindow,
      onRenderProcessGone: options.onRenderProcessGone,
      onDidFinishLoad: options.onDidFinishLoad,
      onClosed: options.onClosed,
      sendIpc: options.sendIpc,
      abortActiveFlow: (sender) => this.abortActiveFlow(sender),
      setState: options.setState,
      isQuitting: options.isQuitting,
      applySecurityGuards: options.applySecurityGuards,
      loadFile: options.loadFile,
    });
  }

  public get session(): RendererSession<TSender> {
    return this.controller.session;
  }

  public ensureCaptureWindow(): TWindow | null {
    return this.controller.ensureCaptureWindow();
  }

  public sendToCaptureWindow(channel: string, ...args: any[]): boolean {
    return this.controller.sendToCaptureWindow(channel, ...args);
  }

  public isReady(): boolean {
    return this.controller.isReady();
  }

  public restoreCapturedSelection(sequenceId?: number): boolean {
    try {
      const restored = selectionOwnershipManager.restoreCapturedSelection(sequenceId, this.options.selectionClipboardPort);
      this.activeSelectionText = "";
      return restored;
    } catch (err: any) {
      logger.warn({ err: err?.message || String(err) }, "Failed to restore captured selection");
      this.activeSelectionText = "";
      return false;
    }
  }

  public markCaptureActive(sequenceId: number): void {
    this.activeCaptureSequenceId = sequenceId;
    this.captureActive = true;
  }

  public markCaptureInactive(sequenceId?: number): void {
    if (sequenceId === undefined || sequenceId === this.activeCaptureSequenceId) {
      this.captureActive = false;
      this.activeCaptureSequenceId = null;
    }
  }

  public isCaptureActive(newSequenceId?: number): boolean {
    if (!this.captureActive) return false;
    const currentState = this.lifecycle.snapshot().state;
    if (currentState === "idle" || currentState === "error") {
      this.captureActive = false;
      this.activeCaptureSequenceId = null;
      return false;
    }
    if (this.activeCaptureSequenceId !== null && this.activeCaptureSequenceId !== newSequenceId) {
      return true;
    }
    return false;
  }

  public abortSelectionCapture(): void {
    this.activeSelectionAbortController?.abort();
    this.activeSelectionAbortController = null;
  }

  public abortSTT(): void {
    if (this.activeSTTAbortController) {
      this.activeSTTAbortController.abort();
      this.activeSTTAbortController = null;
    }
  }

  public createSTTAbortController(): AbortController {
    this.abortSTT();
    const controller = new AbortController();
    this.activeSTTAbortController = controller;
    return controller;
  }

  public abortActiveFlow(failedSender?: TSender): void {
    this.abortSelectionCapture();
    this.abortSTT();
    const currentSeq = this.lifecycle.snapshot().sequenceId;
    this.markCaptureInactive(currentSeq);
    this.pasteCoordinator.invalidate();
    this.lifecycle.cancel();
    this.markCaptureInactive();
    this.restoreCapturedSelection(currentSeq);
    if (failedSender) {
      this.session.detach(failedSender);
    }
  }

  public enforceIpcSender(
    event: { sender: TSender; frame?: any },
    channel: string
  ): { role: RendererRole; window: TWindow } {
    const popoverWin = this.options.getPopoverWindow ? this.options.getPopoverWindow() : null;
    const hudWin = this.options.getHudWindow ? this.options.getHudWindow() : null;
    const result = validateIpcSenderPolicy(
      event as any,
      channel,
      popoverWin as any,
      this.controller.getCaptureWindow() as any,
      hudWin as any
    );
    if (result.role === "capture" && !this.session.isAvailable(event.sender)) {
      throw new Error(`Unauthorized IPC sender: capture session not available or stale for channel '${channel}'`);
    }
    return result as any;
  }

  public async startRecordingFlow(): Promise<boolean> {
    const reqRes = this.lifecycle.snapshot();
    if (reqRes.state !== "starting") {
      logger.warn({ state: reqRes.state }, "Cannot start recording flow");
      return false;
    }

    if (this.isCaptureActive(reqRes.sequenceId)) {
      logger.warn("Cannot start recording: prior capture is active or tearing down");
      this.pasteCoordinator.invalidate();
      this.lifecycle.acknowledgeStart(reqRes.sequenceId, false);
      this.options.setState("idle", "Prior capture engine active");
      return false;
    }

    if (!this.isReady()) {
      logger.warn("Cannot start recording: capture window is not ready");
      this.pasteCoordinator.invalidate();
      this.lifecycle.acknowledgeStart(reqRes.sequenceId, false);
      this.options.setState("idle", "Capture engine not ready");
      return false;
    }

    const targetSender = this.options.getWebContents(this.controller.getCaptureWindow()!);

    // CRITICAL (Finding 4): Send START_RECORDING FIRST before any target capture, starting state, or chime side effects!
    const inputGain = this.options.getInputGain();
    const sent = this.sendToCaptureWindow(IPC.START_RECORDING, "webm", inputGain, reqRes.sequenceId);
    if (!sent) {
      logger.warn("Failed to send START_RECORDING to capture window");
      this.markCaptureInactive(reqRes.sequenceId);
      this.pasteCoordinator.invalidate();
      this.lifecycle.acknowledgeStart(reqRes.sequenceId, false);
      this.options.setState("idle", "Capture engine not ready");
      return false;
    }

    this.markCaptureActive(reqRes.sequenceId);

    // Side effects execute ONLY after send succeeds!
    this.pasteCoordinator.invalidate();
    this.options.capturePasteTarget();
    this.options.setState("starting", "Starting...");
    this.options.playStartChime();

    const selectionAbortController = new AbortController();
    this.activeSelectionAbortController = selectionAbortController;
    let selection: Awaited<ReturnType<typeof this.options.captureActiveSelection>>;
    try {
      selection = await this.options.captureActiveSelection(350, {
        signal: selectionAbortController.signal,
        port: this.options.selectionClipboardPort ?? undefined,
      });
    } catch (err: any) {
      if (this.activeSelectionAbortController === selectionAbortController) this.activeSelectionAbortController = null;
      const snapshot = this.lifecycle.snapshot();
      this.markCaptureInactive(reqRes.sequenceId);
      if (snapshot.sequenceId !== reqRes.sequenceId || snapshot.state !== "starting") return false;
      this.pasteCoordinator.invalidate();
      this.lifecycle.acknowledgeStart(reqRes.sequenceId, false);
      selectionOwnershipManager.clearOwnership(reqRes.sequenceId);
      if (
        this.controller.getCaptureWindow() &&
        this.options.getWebContents(this.controller.getCaptureWindow()!) === targetSender &&
        this.session.isAvailable(targetSender)
      ) {
        this.sendToCaptureWindow(IPC.CANCEL_RECORDING);
      }
      logger.error({ err: err?.message || String(err) }, "Selection capture failed");
      this.options.setState("error", "Selection capture failed");
      return false;
    }
    if (this.activeSelectionAbortController === selectionAbortController) this.activeSelectionAbortController = null;
    const lifecycleSnapshot = this.lifecycle.snapshot();
    if (lifecycleSnapshot.sequenceId !== reqRes.sequenceId || !["starting", "recording"].includes(lifecycleSnapshot.state)) {
      if (
        lifecycleSnapshot.sequenceId === reqRes.sequenceId &&
        this.controller.getCaptureWindow() &&
        this.options.getWebContents(this.controller.getCaptureWindow()!) === targetSender &&
        this.session.isAvailable(targetSender)
      ) {
        this.sendToCaptureWindow(IPC.CANCEL_RECORDING);
      }
      if (selection.hasSelection) {
        const ownershipSnapshot = this.options.selectionClipboardPort
          ? this.options.selectionClipboardPort.snapshot()
          : { formats: [], text: selection.selectedText };
        selectionOwnershipManager.setOwnership({
          sequenceId: reqRes.sequenceId,
          previousClipboard: selection.previousClipboard,
          hasSelection: true,
          selectedText: selection.selectedText,
          ownershipSnapshot,
        });
        this.restoreCapturedSelection(reqRes.sequenceId);
      } else {
        selectionOwnershipManager.clearOwnership(reqRes.sequenceId);
      }
      return false;
    }

    if (selection.hasSelection) {
      const ownershipSnapshot = this.options.selectionClipboardPort
        ? this.options.selectionClipboardPort.snapshot()
        : { formats: [], text: selection.selectedText };
      selectionOwnershipManager.setOwnership({
        sequenceId: reqRes.sequenceId,
        previousClipboard: selection.previousClipboard,
        hasSelection: true,
        selectedText: selection.selectedText,
        ownershipSnapshot,
      });
    } else {
      selectionOwnershipManager.clearOwnership(reqRes.sequenceId);
    }

    if (this.currentTriggerMode === "edit" && selection.hasSelection) {
      this.activeSelectionText = selection.selectedText;
    } else {
      this.activeSelectionText = "";
    }

    logger.info(
      { triggerMode: this.currentTriggerMode, hasSelection: selection.hasSelection, selectionLength: this.activeSelectionText.length },
      "STARTING recording flow"
    );
    this.options.setState("recording", "Recording...");
    if (this.options.acknowledgeStart) {
      await this.options.acknowledgeStart(reqRes.sequenceId, true);
    } else {
      await this.lifecycle.acknowledgeStart(reqRes.sequenceId, true);
    }
    return true;
  }
}
