import { execSync } from "node:child_process";
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
 * Rapidly attempts to capture selected text from the active foreground macOS application.
 * Performs a temporary `cmd+c` key stroke simulation with a strict 60ms timeout.
 */
export async function captureActiveSelection(timeoutMs = 60): Promise<SelectionCaptureResult> {
  const clip = getClipboard();
  const previousClipboard = clip?.readText() || "";

  try {
    // Clear clipboard briefly or rely on text comparison
    // Trigger OS X System Events keystroke "c" using command down
    execSync(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`, {
      timeout: timeoutMs,
      stdio: "ignore",
    });

    const newClipboard = clip?.readText() || "";
    const trimmedNew = newClipboard.trim();
    const trimmedPrev = previousClipboard.trim();

    if (trimmedNew && trimmedNew !== trimmedPrev) {
      logger.info({ byteLength: trimmedNew.length }, "Captured active text selection from foreground app");
      return {
        hasSelection: true,
        selectedText: trimmedNew,
        previousClipboard,
      };
    }
  } catch (err: any) {
    logger.debug({ err: err?.message || String(err) }, "No selection captured or selection capture timed out");
  }

  return {
    hasSelection: false,
    selectedText: "",
    previousClipboard,
  };
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
