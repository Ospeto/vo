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

const SELECTION_SENTINEL = "__PI_VOICE_SELECTION_SENTINEL__";

/**
 * Captures selected text from the active foreground macOS application using a clipboard sentinel.
 * Executes a simulated `cmd+c` keystroke with 200ms timeout window.
 */
export async function captureActiveSelection(timeoutMs = 350): Promise<SelectionCaptureResult> {
  const clip = getClipboard();
  const previousClipboard = clip?.readText() || "";

  // Write sentinel to clipboard to reliably detect new selection copy
  try {
    clip?.writeText(SELECTION_SENTINEL);
  } catch {}

  return new Promise((resolve) => {
    let resolved = false;

    const finish = (newText: string) => {
      if (resolved) return;
      resolved = true;

      const trimmed = newText.trim();
      if (trimmed && trimmed !== SELECTION_SENTINEL) {
        logger.info({ byteLength: trimmed.length }, "Captured active text selection from foreground app");
        resolve({ hasSelection: true, selectedText: trimmed, previousClipboard });
      } else {
        // Restore previous clipboard if no selection was captured
        try {
          clip?.writeText(previousClipboard);
        } catch {}
        resolve({ hasSelection: false, selectedText: "", previousClipboard });
      }
    };

    const timer = setTimeout(() => {
      const latestText = clip?.readText() || "";
      finish(latestText);
    }, timeoutMs);

    // Wait 120ms for physical hotkey modifier keys (Control/Option) to be released by user hand
    setTimeout(() => {
      // Trigger explicit key code 8 (c) using command down on the active frontmost process
      exec(`osascript -e 'tell application "System Events" to tell (first process whose frontmost is true) to key code 8 using {command down}'`, (err) => {
        if (resolved) return;

        if (err) {
          clearTimeout(timer);
          logger.debug({ err: String(err) }, "Selection keystroke execution warning");
          finish(SELECTION_SENTINEL);
          return;
        }

        // Check clipboard after 40ms buffer
        setTimeout(() => {
          clearTimeout(timer);
          const newText = clip?.readText() || "";
          finish(newText);
        }, 40);
      });
    }, 120);
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
