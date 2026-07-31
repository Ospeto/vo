import { exec, type ChildProcess } from "node:child_process";
import logger from "./logger.js";
import {
  createClipboardPort,
  type ClipboardAdapter,
  type ClipboardPort,
  type ClipboardSnapshot,
} from "./safe-paste.js";

export function createElectronClipboardAdapter(writeBuffer?: ClipboardAdapter<any>["writeBuffer"]): ClipboardAdapter<any> | null {
  try {
    const electron = require("electron");
    const clip = electron.clipboard || electron.default?.clipboard || null;
    if (!clip) return null;
    const hasCustomBufferSupport = typeof writeBuffer === "function";
    return {
      readText: () => clip.readText(),
      writeText: (text) => clip.writeText(text),
      write: (data) => clip.write?.(data),
      clear: () => clip.clear?.(),
      readHTML: () => clip.readHTML?.() || "",
      readRTF: () => clip.readRTF?.() || "",
      readImage: () => clip.readImage?.(),
      availableFormats: () => clip.availableFormats?.() || [],
      readBuffer: (format) => clip.readBuffer?.(format) || Buffer.alloc(0),
      writeBuffer: writeBuffer ? (format, data) => {
        if ((writeBuffer as (format: string, data: Buffer) => unknown)(format, data) === false) {
          throw new Error("Native clipboard buffer write failed");
        }
      } : undefined,
      writeBufferIsAdditive: hasCustomBufferSupport,
    };
  } catch {
    return null;
  }
}

function getElectronClipboardAdapter(): ClipboardAdapter<any> | null {
  return createElectronClipboardAdapter();
}

export function getClipboardPort(overrideAdapter?: ClipboardAdapter<any> | ClipboardPort<any> | null): ClipboardPort<any> | null {
  if (!overrideAdapter) {
    const adapter = getElectronClipboardAdapter();
    return adapter ? createClipboardPort(adapter) : null;
  }
  if ("snapshot" in overrideAdapter && typeof overrideAdapter.snapshot === "function") {
    return overrideAdapter as ClipboardPort<any>;
  }
  return createClipboardPort(overrideAdapter as ClipboardAdapter<any>);
}

export interface SelectionCaptureOptions {
  signal?: AbortSignal;
  port?: ClipboardPort<any> | ClipboardAdapter<any>;
}

export interface SelectionCaptureResult {
  hasSelection: boolean;
  selectedText: string;
  previousClipboard: ClipboardSnapshot | string;
}

const SELECTION_SENTINEL = "__PI_VOICE_SELECTION_SENTINEL__";

/**
 * Captures selected text from the active foreground macOS application using a clipboard sentinel.
 * Uses format-preserving clipboard snapshot/restore and cancellable polling.
 */
export async function captureActiveSelection(
  timeoutMs = 500,
  optionsOrPort?: SelectionCaptureOptions | ClipboardPort<any> | ClipboardAdapter<any>
): Promise<SelectionCaptureResult> {
  let signal: AbortSignal | undefined;
  let portOverride: ClipboardPort<any> | ClipboardAdapter<any> | undefined;

  if (optionsOrPort) {
    if ("signal" in optionsOrPort || "port" in optionsOrPort) {
      const opts = optionsOrPort as SelectionCaptureOptions;
      signal = opts.signal;
      portOverride = opts.port;
    } else {
      portOverride = optionsOrPort as ClipboardPort<any> | ClipboardAdapter<any>;
    }
  }

  const clipPort = getClipboardPort(portOverride);
  let previousSnapshot: ClipboardSnapshot = { formats: [], text: "" };
  if (clipPort) previousSnapshot = clipPort.snapshot();

  // Write sentinel to clipboard to reliably detect new selection copy.
  // Only restore it if the clipboard still has this exact sentinel snapshot.
  let sentinelSnapshot: ClipboardSnapshot | null = null;
  try {
    clipPort?.writeText(SELECTION_SENTINEL);
    sentinelSnapshot = clipPort?.snapshot() ?? null;
  } catch {}

  return new Promise((resolve) => {
    let finished = false;
    let childProc: ChildProcess | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (delayTimer) {
        clearTimeout(delayTimer);
        delayTimer = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (childProc) {
        try {
          childProc.kill();
        } catch {}
        childProc = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const finish = (hasSelection: boolean, text: string) => {
      if (finished) return;
      finished = true;
      cleanup();

      const trimmed = text.trim();
      if (hasSelection && trimmed && trimmed !== SELECTION_SENTINEL) {
        logger.info({ byteLength: trimmed.length }, "Captured active text selection from foreground app");
        resolve({ hasSelection: true, selectedText: trimmed, previousClipboard: previousSnapshot });
      } else {
        // Restore only our sentinel; never overwrite a user or newer capture copy.
        try {
          if (clipPort && sentinelSnapshot && areClipboardSnapshotsEqual(clipPort.snapshot(), sentinelSnapshot)) {
            clipPort.restore(previousSnapshot);
          }
        } catch {}
        resolve({ hasSelection: false, selectedText: "", previousClipboard: previousSnapshot });
      }
    };

    const onAbort = () => {
      finish(false, "");
    };

    if (signal) {
      if (signal.aborted) {
        finish(false, "");
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timeoutTimer = setTimeout(() => {
      finish(false, "");
    }, timeoutMs);

    // Wait upfront for physical hotkey modifier keys (Control/Option) to be released by user hand
    const upfrontDelay = Math.min(120, timeoutMs);
    delayTimer = setTimeout(() => {
      if (finished) return;

      // Trigger key code 8 (c) using command down on frontmost process
      childProc = exec(
        `osascript -e 'tell application "System Events" to tell (first process whose frontmost is true) to key code 8 using {command down}'`,
        (err) => {
          if (finished) return;
          if (err) {
            logger.debug({ err: String(err) }, "Selection keystroke execution warning");
            finish(false, "");
            return;
          }
          // Immediate check upon exec completion
          const currentText = clipPort?.readText() || "";
          if (currentText !== SELECTION_SENTINEL) {
            const trimmed = currentText.trim();
            finish(trimmed.length > 0 && trimmed !== SELECTION_SENTINEL, currentText);
          }
        }
      );

      // Dynamic polling every 20ms until timeout or clipboard text changes from sentinel
      pollInterval = setInterval(() => {
        if (finished) return;
        const currentText = clipPort?.readText() || "";
        if (currentText !== SELECTION_SENTINEL) {
          const trimmed = currentText.trim();
          finish(trimmed.length > 0 && trimmed !== SELECTION_SENTINEL, currentText);
        }
      }, 20);
    }, upfrontDelay);
  });
}

/**
 * Compares two clipboard snapshots (or snapshot / string) for format and content equality.
 * Used to verify if the clipboard was modified by the user or target app after selection capture.
 */
export function areClipboardSnapshotsEqual(
  a: ClipboardSnapshot | string | undefined | null,
  b: ClipboardSnapshot | string | undefined | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  if (typeof a === "string" || typeof b === "string") {
    const textA = typeof a === "string" ? a : (a.text ?? "");
    const textB = typeof b === "string" ? b : (b.text ?? "");
    return textA === textB;
  }

  if ((a.text ?? "") !== (b.text ?? "")) return false;
  if ((a.html ?? "") !== (b.html ?? "")) return false;
  if ((a.rtf ?? "") !== (b.rtf ?? "")) return false;

  const hasImgA = Boolean(a.image && !(a.image.isEmpty?.() ?? false));
  const hasImgB = Boolean(b.image && !(b.image.isEmpty?.() ?? false));
  if (hasImgA !== hasImgB) return false;
  if (hasImgA && hasImgB && a.image && b.image) {
    if (a.image !== b.image) {
      const imgA = a.image as any;
      const imgB = b.image as any;
      const dataA = typeof imgA?.toDataURL === "function" ? imgA.toDataURL() : null;
      const dataB = typeof imgB?.toDataURL === "function" ? imgB.toDataURL() : null;
      if (dataA || dataB) {
        if (dataA !== dataB) return false;
      }
    }
  }

  const formatsA = a.formats || [];
  const formatsB = b.formats || [];
  if (formatsA.length !== formatsB.length) return false;

  for (const itemA of formatsA) {
    const itemB = formatsB.find((f) => f.format.toLowerCase() === itemA.format.toLowerCase());
    if (!itemB) return false;
    if (Buffer.compare(itemA.data, itemB.data) !== 0) return false;
  }

  return true;
}

export interface SelectionOwnership {
  sequenceId: number;
  previousClipboard: ClipboardSnapshot | string;
  hasSelection: boolean;
  selectedText: string;
  ownershipSnapshot: ClipboardSnapshot;
}

export class SelectionOwnershipManager {
  private activeOwnership: SelectionOwnership | null = null;
  private latestSequenceId = 0;

  setOwnership(ownership: SelectionOwnership): void {
    if (ownership.sequenceId < this.latestSequenceId) return;
    this.latestSequenceId = ownership.sequenceId;
    this.activeOwnership = ownership;
  }

  getOwnership(): SelectionOwnership | null {
    return this.activeOwnership;
  }

  clearOwnership(sequenceId?: number): void {
    if (sequenceId === undefined) {
      if (this.activeOwnership) this.latestSequenceId = Math.max(this.latestSequenceId, this.activeOwnership.sequenceId);
      this.activeOwnership = null;
      return;
    }
    if (sequenceId < this.latestSequenceId) return;
    this.latestSequenceId = sequenceId;
    if (!this.activeOwnership || this.activeOwnership.sequenceId <= sequenceId) {
      this.activeOwnership = null;
    }
  }

  resetForTests(): void {
    this.activeOwnership = null;
    this.latestSequenceId = 0;
  }

  restoreCapturedSelection(
    sequenceId?: number,
    portOverride?: ClipboardPort<any> | ClipboardAdapter<any> | null
  ): boolean {
    if (sequenceId !== undefined) {
      if (sequenceId < this.latestSequenceId) return false;
      this.latestSequenceId = sequenceId;
    }
    if (!this.activeOwnership) {
      return false;
    }

    if (sequenceId !== undefined && this.activeOwnership.sequenceId !== sequenceId) {
      logger.info(
        { requestedSequenceId: sequenceId, ownershipSequenceId: this.activeOwnership.sequenceId },
        "Ignoring restoreCapturedSelection for non-matching sequence"
      );
      if (this.activeOwnership.sequenceId < sequenceId) this.activeOwnership = null;
      return false;
    }

    const currentOwnership = this.activeOwnership;
    let restored = false;

    if (currentOwnership.hasSelection) {
      const clipPort = getClipboardPort(portOverride);
      const currentSnapshot = clipPort ? clipPort.snapshot() : { formats: [], text: "" };

      if (areClipboardSnapshotsEqual(currentSnapshot, currentOwnership.ownershipSnapshot)) {
        logger.info(
          { sequenceId: currentOwnership.sequenceId },
          "Clipboard unchanged since selection capture; restoring previous selection clipboard"
        );
        restoreClipboard(currentOwnership.previousClipboard, portOverride);
        restored = true;
      } else {
        logger.info(
          { sequenceId: currentOwnership.sequenceId },
          "Clipboard modified by user or target app since selection capture; skipping restoration"
        );
      }
    }

    this.activeOwnership = null;
    return restored;
  }
}

export const selectionOwnershipManager = new SelectionOwnershipManager();

/**
 * Restores the previous clipboard content using format-preserving ClipboardPort.
 */
export function restoreClipboard(
  previousClipboard: ClipboardSnapshot | string,
  portOverride?: ClipboardPort<any> | ClipboardAdapter<any> | null
): void {
  try {
    const clipPort = getClipboardPort(portOverride);
    if (!clipPort) return;

    if (typeof previousClipboard === "string") {
      if (previousClipboard) {
        clipPort.writeText(previousClipboard);
      } else {
        clipPort.restore({ formats: [], text: "" });
      }
    } else if (previousClipboard) {
      clipPort.restore(previousClipboard);
    }
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err) }, "Failed to restore previous clipboard state");
  }
}
