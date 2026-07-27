import { exec } from "node:child_process";
import logger from "./logger.js";

function getClipboard(): { readText(): string; writeText(text: string): void } | null {
  try {
    const electron = require("electron");
    return electron.clipboard || electron.default?.clipboard || null;
  } catch {
    return null;
  }
}

export interface SelectionCaptureResult {
  hasSelection: boolean;
  selectedText: string;
  previousClipboard: string;
}

/**
 * Captures selected text from the active foreground macOS application.
 * Executes a simulated `cmd+c` keystroke with 250ms timeout window.
 */
export async function captureActiveSelection(timeoutMs = 250): Promise<SelectionCaptureResult> {
  const clip = getClipboard();
  const previousClipboard = clip?.readText() || "";

  return new Promise((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const latestText = clip?.readText() || "";
      const trimmedLatest = latestText.trim();
      const trimmedPrev = previousClipboard.trim();

      if (trimmedLatest && trimmedLatest !== trimmedPrev) {
        logger.info({ byteLength: trimmedLatest.length }, "Captured active text selection (fallback timer)");
        resolve({ hasSelection: true, selectedText: trimmedLatest, previousClipboard });
      } else {
        resolve({ hasSelection: false, selectedText: "", previousClipboard });
      }
    }, timeoutMs);

    // Trigger AppleScript keystroke "c" using command down
    exec(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`, (err) => {
      if (resolved) return;
      clearTimeout(timer);
      resolved = true;

      if (err) {
        logger.debug({ err: String(err) }, "Selection keystroke execution warning");
        resolve({ hasSelection: false, selectedText: "", previousClipboard });
        return;
      }

      // Allow 30ms for clipboard buffer to update
      setTimeout(() => {
        const newClipboard = clip?.readText() || "";
        const trimmedNew = newClipboard.trim();
        const trimmedPrev = previousClipboard.trim();

        if (trimmedNew && trimmedNew !== trimmedPrev) {
          logger.info({ byteLength: trimmedNew.length }, "Captured active text selection from foreground app");
          resolve({ hasSelection: true, selectedText: trimmedNew, previousClipboard });
        } else {
          resolve({ hasSelection: false, selectedText: "", previousClipboard });
        }
      }, 30);
    });
  });
}

/**
 * Restores the previous clipboard content.
 */
export function restoreClipboard(previousClipboard: string): void {
  try {
    const clip = getClipboard();
    if (clip && previousClipboard !== undefined) {
      clip.writeText(previousClipboard);
    }
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err) }, "Failed to restore previous clipboard state");
  }
}
