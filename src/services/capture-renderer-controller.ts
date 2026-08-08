import { RendererSession } from "./renderer-session.js";
import { IPC } from "../shared/types.js";
import logger from "./logger.js";

export interface CaptureRendererControllerOptions<TSender, TWindow> {
  session?: RendererSession<TSender>;
  createWindow: () => TWindow;
  getWebContents: (win: TWindow) => TSender;
  isDestroyed: (win: TWindow) => boolean;
  destroyWindow: (win: TWindow) => void;
  onRenderProcessGone: (sender: TSender, handler: (event: any, details: any) => void) => void;
  onDidFinishLoad: (sender: TSender, handler: () => void) => void;
  onClosed: (win: TWindow, handler: () => void) => void;
  sendIpc: (sender: TSender, channel: string, ...args: any[]) => void;
  abortActiveFlow: (sender?: TSender) => void;
  setState: (state: any, message?: string) => void;
  isQuitting: () => boolean;
  applySecurityGuards?: (win: TWindow) => void;
  loadFile?: (win: TWindow) => void;
}

export class CaptureRendererController<TSender = any, TWindow = any> {
  public session: RendererSession<TSender>;
  private captureWindow: TWindow | null = null;
  private pendingCaptureWindow: TWindow | null = null;
  private isRecovering = false;
  private options: CaptureRendererControllerOptions<TSender, TWindow>;

  constructor(options: CaptureRendererControllerOptions<TSender, TWindow>) {
    this.options = options;
    this.session = options.session ?? new RendererSession<TSender>();
  }

  getCaptureWindow(): TWindow | null {
    return this.captureWindow;
  }

  getPendingCaptureWindow(): TWindow | null {
    return this.pendingCaptureWindow;
  }

  isReady(): boolean {
    if (!this.captureWindow || this.options.isDestroyed(this.captureWindow)) return false;
    const sender = this.options.getWebContents(this.captureWindow);
    return this.session.isAvailable(sender);
  }

  sendToCaptureWindow(channel: string, ...args: any[]): boolean {
    if (!this.captureWindow || this.options.isDestroyed(this.captureWindow)) return false;
    const sender = this.options.getWebContents(this.captureWindow);
    if (!this.session.isAvailable(sender)) return false;
    try {
      this.options.sendIpc(sender, channel, ...args);
      return true;
    } catch (err: any) {
      logger.warn({ channel, err: err?.message || String(err) }, "Failed to send IPC to capture renderer");
      return false;
    }
  }

  ensureCaptureWindow(): TWindow | null {
    if (this.captureWindow || this.pendingCaptureWindow || this.options.isQuitting()) {
      return this.captureWindow ?? this.pendingCaptureWindow;
    }

    const win = this.options.createWindow();
    this.pendingCaptureWindow = win;

    const sender = this.options.getWebContents(win);
    const generation = this.session.attach(sender);

    this.options.onDidFinishLoad(sender, () => {
      if (this.options.isDestroyed(win)) return;
      if (!this.session.acknowledgeReady(sender, generation)) return;
      this.captureWindow = win;
      this.pendingCaptureWindow = null;

      if (this.isRecovering) {
        this.isRecovering = false;
        this.options.setState("idle", "Capture engine recovered");
      }
    });

    this.options.onRenderProcessGone(sender, (_event: any, details: any) => {
      logger.error({ details }, "Capture renderer process crashed, auto-recovering...");

      // Identity check: ignore stale/duplicate loss events for superseded windows
      if (this.captureWindow !== win && this.pendingCaptureWindow !== win) return;

      if (this.captureWindow === win) this.captureWindow = null;
      if (this.pendingCaptureWindow === win) this.pendingCaptureWindow = null;

      this.isRecovering = true;
      this.options.abortActiveFlow(sender);

      if (!this.options.isDestroyed(win)) {
        this.options.destroyWindow(win);
      }

      if (!this.options.isQuitting()) {
        this.ensureCaptureWindow();
      }
    });

    this.options.onClosed(win, () => {
      // Identity check: ignore stale/duplicate closed events for superseded windows
      if (this.captureWindow !== win && this.pendingCaptureWindow !== win) return;

      if (this.captureWindow === win) this.captureWindow = null;
      if (this.pendingCaptureWindow === win) this.pendingCaptureWindow = null;

      this.isRecovering = true;
      this.options.abortActiveFlow(sender);

      if (!this.options.isQuitting()) {
        this.ensureCaptureWindow();
      }
    });

    if (this.options.applySecurityGuards) {
      this.options.applySecurityGuards(win);
    }
    if (this.options.loadFile) {
      this.options.loadFile(win);
    }

    return win;
  }

  reset(): void {
    this.captureWindow = null;
    this.pendingCaptureWindow = null;
  }

  destroyCaptureWindow(): void {
    const win = this.captureWindow;
    const pendingWin = this.pendingCaptureWindow;
    this.captureWindow = null;
    this.pendingCaptureWindow = null;
    if (win && !this.options.isDestroyed(win)) {
      try {
        this.options.destroyWindow(win);
      } catch (_err) {
        // ignore
      }
    }
    if (pendingWin && pendingWin !== win && !this.options.isDestroyed(pendingWin)) {
      try {
        this.options.destroyWindow(pendingWin);
      } catch (_err) {
        // ignore
      }
    }
  }

  async teardownCaptureWindow(timeoutMs: number = 2000): Promise<void> {
    const win = this.captureWindow;
    const pendingWin = this.pendingCaptureWindow;

    // Unconditionally and safely detach sessions for active and pending windows FIRST
    if (win) {
      try {
        const contents = this.options.getWebContents(win);
        if (contents) {
          if (this.session.isAvailable(contents)) {
            try {
              this.options.sendIpc(contents, IPC.CANCEL_RECORDING);
            } catch (_err) {
              // ignore
            }
          }
          try {
            this.session.detach(contents);
          } catch (_err) {
            // ignore
          }
        }
      } catch (_err) {
        // ignore
      }
    }

    if (pendingWin && pendingWin !== win) {
      try {
        const pendingContents = this.options.getWebContents(pendingWin);
        if (pendingContents) {
          try {
            this.session.detach(pendingContents);
          } catch (_err) {
            // ignore
          }
        }
      } catch (_err) {
        // ignore
      }
    }

    let closedPromise: Promise<void> | null = null;
    if (win && !this.options.isDestroyed(win)) {
      closedPromise = new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let done = false;
        const cleanup = () => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          resolve();
        };

        timer = setTimeout(cleanup, Math.min(timeoutMs, 2000));
        try {
          this.options.onClosed(win, cleanup);
        } catch {
          cleanup();
        }
      });
    }

    this.destroyCaptureWindow();

    if (closedPromise) {
      await closedPromise;
    }
  }
}
