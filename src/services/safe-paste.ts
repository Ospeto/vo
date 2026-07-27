import type { NativePasteAddon } from "./native-paste-addon.js";

export type TargetIdentity = { bundleId: string; appName: string; pid: number; windowId: number; windowTitle?: string };
export type TargetFailureReason = "target_unavailable" | "target_malformed" | "target_mismatch" | "native_unavailable";
export type InjectionFailureReason = "permission_blocked" | "injection_rejected" | "injection_failed";
export type ClipboardFailureReason = "clipboard_snapshot_failed" | "clipboard_write_failed" | "clipboard_restore_failed";
export type SafePasteFailureReason = TargetFailureReason | InjectionFailureReason | ClipboardFailureReason;
export type SafePasteResult = { ok: true; reason: "injection_requested" } | { ok: false; reason: SafePasteFailureReason };
export type TargetReadResult = { target: TargetIdentity | null; reason: TargetFailureReason | null };
export type SafePasteDiagnosticStage = "target_capture" | "target_recheck" | "clipboard_snapshot" | "clipboard_write" | "injection" | "clipboard_hold" | "clipboard_restore" | "total";
export type SafePasteDiagnosticOutcome = "captured" | "failed" | "not_run" | "authorization_accepted" | "authorization_rejected" | "success" | "failure";
export type SafePasteDiagnostic = {
  operationId: string;
  stage: SafePasteDiagnosticStage;
  durationMs: number;
  targetMode: "window";
  outcome: SafePasteDiagnosticOutcome;
  reason?: SafePasteFailureReason;
};
export type SafePasteDiagnostics = { emit: (diagnostic: SafePasteDiagnostic) => void; now?: () => number };
export const POST_INJECTION_CLIPBOARD_HOLD_MS = 250;
type SafePasteHold = (durationMs: number) => Promise<void>;

const normalize = (value: string): string => value.trim().toLowerCase();
const MAX_PID = 2147483647;
const MAX_WINDOW_ID = 4294967295;
const isValidTarget = (target: TargetIdentity | null): target is TargetIdentity => Boolean(target &&
  typeof target.bundleId === "string" && target.bundleId.trim() &&
  typeof target.appName === "string" && target.appName.trim() &&
  Number.isSafeInteger(target.pid) && target.pid > 0 && target.pid <= MAX_PID &&
  Number.isSafeInteger(target.windowId) && target.windowId > 0 && target.windowId <= MAX_WINDOW_ID &&
  (target.windowTitle === undefined || !/[\t\r\n]/.test(target.windowTitle)) &&
  !/[\t\r\n]/.test(target.bundleId + target.appName));

export function parseTargetLine(line: string): TargetIdentity | null {
  const fields = line.replace(/\n$/, "").split("\t");
  if (fields.length !== 5) return null;
  const bundleId = fields[0];
  const appName = fields[1];
  const pidText = fields[2];
  const windowIdText = fields[3];
  const windowTitle = fields[4];
  if (bundleId === undefined || appName === undefined || pidText === undefined || windowIdText === undefined || windowTitle === undefined) return null;
  const pid = Number(pidText);
  const windowId = Number(windowIdText);
  const parsed = { bundleId, appName, pid, windowId, windowTitle: windowTitle || undefined };
  return /^\d+$/.test(pidText) && /^\d+$/.test(windowIdText) && isValidTarget(parsed) ? parsed : null;
}

export function sameTarget(a: TargetIdentity, b: TargetIdentity): boolean {
  return isValidTarget(a) && isValidTarget(b) && normalize(a.bundleId) === normalize(b.bundleId) && normalize(a.appName) === normalize(b.appName) && a.pid === b.pid && a.windowId === b.windowId;
}

const targetResult = (value: TargetIdentity | null | TargetReadResult): TargetReadResult => {
  if (value && typeof value === "object" && "target" in value) return value;
  return value ? { target: value, reason: null } : { target: null, reason: "target_unavailable" };
};
const isSafeFailureReason = (value: unknown): value is SafePasteFailureReason => value === "target_unavailable" || value === "target_malformed" || value === "target_mismatch" || value === "native_unavailable" || value === "permission_blocked" || value === "injection_rejected" || value === "injection_failed" || value === "clipboard_snapshot_failed" || value === "clipboard_write_failed" || value === "clipboard_restore_failed";
const safeReason = (value: unknown, fallback: SafePasteFailureReason): SafePasteFailureReason => isSafeFailureReason(value) ? value : fallback;
const failureReason = (error: unknown, fallback: SafePasteFailureReason): SafePasteFailureReason => {
  const reason = error && typeof error === "object" && "reason" in error ? (error as { reason?: unknown }).reason : undefined;
  return safeReason(reason, fallback);
};

export class SafePasteService {
  private capturedTarget: TargetIdentity | null = null;
  private captureFailure: TargetFailureReason | null = null;
  private captureDuration = 0;
  private capturePromise: Promise<void> | null = null;
  private static nextOperationId = 1;
  constructor(
    private readonly readTarget: () => TargetIdentity | null | TargetReadResult | Promise<TargetIdentity | null | TargetReadResult>,
    private readonly injectPaste: (expected: TargetIdentity) => Promise<void>,
    private readonly clipboard: ClipboardPort,
    private readonly authorizeTarget: (expected: TargetIdentity) => Promise<void> = async (expected) => {
      const current = targetResult(await this.readTarget());
      if (!current.target) throw Object.assign(new Error(current.reason ?? "target_unavailable"), { reason: current.reason ?? "target_unavailable" });
      if (!isValidTarget(current.target)) throw Object.assign(new Error("target_malformed"), { reason: "target_malformed" });
      if (!sameTarget(expected, current.target)) throw Object.assign(new Error("target_mismatch"), { reason: "target_mismatch" });
    },
    private readonly diagnostics?: SafePasteDiagnostics,
    private readonly hold: SafePasteHold = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
  ) {}
  captureTarget(): TargetIdentity | null {
    const started = this.clock();
    const capturedValue = this.readTarget();
    if (capturedValue instanceof Promise) {
      this.capturePromise = capturedValue.then((value) => { this.applyCapture(targetResult(value)); this.captureDuration = this.elapsed(started); });
      return null;
    }
    const captured = targetResult(capturedValue);
    this.applyCapture(captured);
    this.captureDuration = this.elapsed(started);
    return this.capturedTarget;
  }
  private applyCapture(captured: TargetReadResult): void {
    this.capturedTarget = captured.target && isValidTarget(captured.target) ? captured.target : null;
    this.captureFailure = captured.target && !isValidTarget(captured.target) ? "target_malformed" : (captured.reason ? safeReason(captured.reason, "target_unavailable") as TargetFailureReason : null);
  }
  async paste(text: string): Promise<SafePasteResult> {
    if (this.capturePromise) { await this.capturePromise; this.capturePromise = null; }
    const operationId = `paste-${SafePasteService.nextOperationId++}`;
    const started = this.clock();
    const captureReason = this.captureFailure ?? (this.capturedTarget ? null : "target_unavailable");
    this.emit({ operationId, stage: "target_capture", durationMs: this.captureDuration, outcome: this.capturedTarget ? "captured" : "failed", reason: captureReason ?? undefined });
    if (!isValidTarget(this.capturedTarget)) {
      this.emit({ operationId, stage: "target_recheck", durationMs: 0, outcome: "not_run", reason: captureReason ?? "target_unavailable" });
      const result = { ok: false as const, reason: captureReason ?? "target_unavailable" as TargetFailureReason };
      this.emitTotal(operationId, started, result);
      return result;
    }
    const recheckStarted = this.clock();
    try {
      await this.authorizeTarget(this.capturedTarget);
      this.emit({ operationId, stage: "target_recheck", durationMs: this.elapsed(recheckStarted), outcome: "authorization_accepted" });
    }
    catch (error) {
      const reason = failureReason(error, "target_unavailable") as TargetFailureReason;
      this.emit({ operationId, stage: "target_recheck", durationMs: this.elapsed(recheckStarted), outcome: "authorization_rejected", reason });
      const result = { ok: false as const, reason };
      this.emitTotal(operationId, started, result);
      return result;
    }
    let previous: ClipboardSnapshot;
    const snapshotStarted = this.clock();
    try {
      previous = this.clipboard.snapshot();
      this.emit({ operationId, stage: "clipboard_snapshot", durationMs: this.elapsed(snapshotStarted), outcome: "success" });
      if (previous.formats.length > 0 && !this.clipboard.preservesCustomFormats) {
        const result = { ok: false as const, reason: "clipboard_restore_failed" as ClipboardFailureReason };
        this.emit({ operationId, stage: "clipboard_restore", durationMs: 0, outcome: "failure", reason: result.reason });
        this.emitTotal(operationId, started, result);
        return result;
      }
    } catch {
      const result = { ok: false as const, reason: "clipboard_snapshot_failed" as ClipboardFailureReason };
      this.emit({ operationId, stage: "clipboard_snapshot", durationMs: this.elapsed(snapshotStarted), outcome: "failure", reason: result.reason });
      this.emitTotal(operationId, started, result);
      return result;
    }
    let result: SafePasteResult | undefined;
    const writeStarted = this.clock();
    try {
      this.clipboard.writeText(text);
      this.emit({ operationId, stage: "clipboard_write", durationMs: this.elapsed(writeStarted), outcome: "success" });
    }
    catch (error) {
      const reason = "clipboard_write_failed" as ClipboardFailureReason;
      this.emit({ operationId, stage: "clipboard_write", durationMs: this.elapsed(writeStarted), outcome: "failure", reason });
      result = { ok: false, reason };
    }
    if (result === undefined) {
      const injectionStarted = this.clock();
      try {
        await this.injectPaste(this.capturedTarget);
        this.emit({ operationId, stage: "injection", durationMs: this.elapsed(injectionStarted), outcome: "success" });
        result = { ok: true, reason: "injection_requested" };
      } catch (error) {
        const reason = failureReason(error, "injection_rejected");
        this.emit({ operationId, stage: "injection", durationMs: this.elapsed(injectionStarted), outcome: "failure", reason });
        result = { ok: false, reason };
      }
    }
    if (result?.ok) {
      const holdStarted = this.clock();
      try {
        await this.hold(POST_INJECTION_CLIPBOARD_HOLD_MS);
        this.emit({ operationId, stage: "clipboard_hold", durationMs: this.elapsed(holdStarted), outcome: "success" });
      } catch {
        this.emit({ operationId, stage: "clipboard_hold", durationMs: this.elapsed(holdStarted), outcome: "failure" });
      }
    }
    const restoreStarted = this.clock();
    try {
      this.clipboard.restore(previous!);
      this.emit({ operationId, stage: "clipboard_restore", durationMs: this.elapsed(restoreStarted), outcome: "success" });
    } catch {
      result = { ok: false, reason: "clipboard_restore_failed" };
      this.emit({ operationId, stage: "clipboard_restore", durationMs: this.elapsed(restoreStarted), outcome: "failure", reason: result.reason });
    }
    if (!result) result = { ok: false, reason: "injection_rejected" };
    this.emitTotal(operationId, started, result);
    return result;
  }
  private clock(): number {
    try {
      const sampled = this.diagnostics?.now?.();
      if (sampled === undefined || Number.isFinite(sampled)) return sampled ?? this.monotonicClock();
    } catch { /* use the process monotonic clock */ }
    return this.monotonicClock();
  }
  private monotonicClock(): number {
    try {
      const sampled = performance.now();
      return Number.isFinite(sampled) ? sampled : 0;
    } catch { return 0; }
  }
  private elapsed(started: number): number { return Math.max(0, this.clock() - started); }
  private emit(diagnostic: Omit<SafePasteDiagnostic, "targetMode"> & { targetMode?: "window" }): void {
    try { this.diagnostics?.emit({ ...diagnostic, targetMode: "window" }); } catch { /* diagnostics must not affect paste */ }
  }
  private emitTotal(operationId: string, started: number, result: SafePasteResult): void {
    this.emit({ operationId, stage: "total", durationMs: this.elapsed(started), targetMode: "window", outcome: result.ok ? "success" : "failure", reason: result.ok ? undefined : result.reason });
  }
}

export type ClipboardImage = { isEmpty?: () => boolean };
type ClipboardWriteData<TImage extends ClipboardImage> = { text?: string; html?: string; rtf?: string; image?: TImage };
export type ClipboardSnapshot = {
  text?: string;
  html?: string;
  rtf?: string;
  image?: ClipboardImage;
  formats: Array<{ format: string; data: Buffer }>;
};
export type ClipboardPort<TImage extends ClipboardImage = ClipboardImage> = { readText(): string; writeText(text: string): void; snapshot(): ClipboardSnapshot & { image?: TImage }; restore(snapshot: ClipboardSnapshot & { image?: TImage }): void; preservesCustomFormats?: boolean };
export type ClipboardAdapter<TImage extends ClipboardImage> = {
  readText(): string;
  writeText(text: string): void;
  write?: (data: ClipboardWriteData<TImage>) => void;
  clear?: () => void;
  readHTML?: () => string;
  readRTF?: () => string;
  readImage?: () => TImage;
  availableFormats?: () => string[];
  readBuffer?: (format: string) => Buffer;
  writeBuffer?: (format: string, data: Buffer) => void;
  /** True only for a verified implementation where writeBuffer is additive. */
  writeBufferIsAdditive?: boolean;
};

export function createClipboardPort<TImage extends ClipboardImage>(clipboard: ClipboardAdapter<TImage>): ClipboardPort<TImage> {
  const standardFormats = new Set(["text/plain", "text/html", "text/rtf", "image/png", "image/jpeg", "image/gif", "image/bmp"]);
  const hasFormat = (formats: string[], name: string): boolean => formats.some((format) => format.toLowerCase() === name);
  const hasImage = (image: TImage | undefined): boolean => image !== undefined && !(image.isEmpty?.() ?? false);
  return {
    preservesCustomFormats: Boolean(clipboard.writeBufferIsAdditive && clipboard.writeBuffer),
    readText: () => clipboard.readText(), writeText: (text) => clipboard.writeText(text),
    snapshot: () => {
      const formats = clipboard.availableFormats?.() ?? [];
      const text = clipboard.readText();
      const html = clipboard.readHTML?.() || undefined;
      const rtf = clipboard.readRTF?.() || undefined;
      const image = clipboard.readImage ? clipboard.readImage() : undefined;
      return {
        text: text && (hasFormat(formats, "text/plain") || !clipboard.availableFormats) ? text : undefined,
        html: html && hasFormat(formats, "text/html") ? html : undefined,
        rtf: rtf && hasFormat(formats, "text/rtf") ? rtf : undefined,
        image: hasImage(image) && formats.some((format) => format.toLowerCase().startsWith("image/")) ? image : undefined,
        formats: formats.filter((format) => !standardFormats.has(format.toLowerCase())).map((format) => ({ format, data: clipboard.readBuffer?.(format) ?? Buffer.alloc(0) })),
      };
    },
    // Electron documents clipboard.write({ text, html, rtf, image }) as the
    // atomic operation for standard representations.  Arbitrary formats are
    // not part of that guarantee; only append them when the caller has
    // explicitly verified that its writeBuffer implementation is additive.
    restore: (snapshot) => {
      const hasStandardData = Boolean(snapshot.text || snapshot.html || snapshot.rtf || hasImage(snapshot.image));
      if (clipboard.write && hasStandardData) {
        const data: ClipboardWriteData<TImage> = {};
        if (snapshot.text) data.text = snapshot.text;
        if (snapshot.html) data.html = snapshot.html;
        if (snapshot.rtf) data.rtf = snapshot.rtf;
        if (hasImage(snapshot.image)) data.image = snapshot.image;
        clipboard.write(data);
      } else if (!clipboard.write && snapshot.text) {
        clipboard.writeText(snapshot.text);
      }
      // Empty snapshots and custom-only snapshots must replace the temporary
      // clipboard contents. Custom buffers are restorable only when their
      // implementation has explicitly been verified as additive.
      if (!hasStandardData) clipboard.clear?.();
      if (clipboard.writeBufferIsAdditive && clipboard.writeBuffer) {
        for (const item of snapshot.formats) clipboard.writeBuffer(item.format, item.data);
      }
    },
  };
}

export function createMacSafePasteService<TImage extends ClipboardImage>(addon: NativePasteAddon | null, clipboard: ClipboardAdapter<TImage>): SafePasteService {
  const readTarget = (): TargetReadResult => {
    if (!addon) return { target: null, reason: "native_unavailable" };
    try {
      const result = addon.capture();
      return result.ok ? { target: result, reason: null } : { target: null, reason: result.reason === "permission_blocked" ? "target_unavailable" : result.reason as TargetFailureReason };
    } catch { return { target: null, reason: "native_unavailable" }; }
  };
  const authorizeTarget = async (expected: TargetIdentity): Promise<void> => {
    if (!addon) throw Object.assign(new Error("native addon unavailable"), { reason: "native_unavailable" });
    try { const result = addon.authorize(expected); if (!result.ok) throw Object.assign(new Error(result.reason), { reason: result.reason }); }
    catch (error) { throw Object.assign(new Error("native authorization failed"), { reason: failureReason(error, "target_unavailable") }); }
  };
  const injectPaste = async (expected: TargetIdentity): Promise<void> => {
    if (!addon) throw Object.assign(new Error("native addon unavailable"), { reason: "native_unavailable" });
    try { const result = addon.inject(expected); if (!result.ok) throw Object.assign(new Error(result.reason), { reason: result.reason }); }
    catch (error) { throw Object.assign(new Error("native injection failed"), { reason: failureReason(error, "injection_rejected") }); }
  };
  return new SafePasteService(readTarget, injectPaste, createClipboardPort(clipboard), authorizeTarget);
}
