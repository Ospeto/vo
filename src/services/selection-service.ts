import { exec, type ChildProcess } from "node:child_process";
import logger from "./logger.js";
import {
  createClipboardPort,
  type ClipboardAdapter,
  type ClipboardPort,
  type ClipboardSnapshot,
} from "./safe-paste.js";

function getElectronClipboardAdapter(): ClipboardAdapter<any> | null {
  try {
    const electron = require("electron");
    const clip = electron.clipboard || electron.default?.clipboard || null;
    if (!clip) return null;
    const hasCustomBufferSupport = typeof clip.writeBuffer === "function";
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
      writeBuffer: hasCustomBufferSupport ? (format, data) => clip.writeBuffer(format, data) : undefined,
      writeBufferIsAdditive: hasCustomBufferSupport,
    };
  } catch {
    return null;
  }
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

  // Write sentinel to clipboard to reliably detect new selection copy
  try {
    clipPort?.writeText(SELECTION_SENTINEL);
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
        // Restore previous clipboard if no selection was captured
        try {
          if (clipPort) {
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
