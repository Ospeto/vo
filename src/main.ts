import { z } from "zod";
import { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, clipboard, Notification, type IpcMainInvokeEvent } from "electron";
import {
  validateIpcSenderPolicy,
  getSanitizedSettingsConfig,
  getCaptureConfigPayload,
  applyWindowSecurityGuards,
} from "./services/ipc-policy.js";
import { RendererSession } from "./services/renderer-session.js";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, updateConfig, configPatchSchema, parseKeyBinding, formatKeyBinding, defaultConfig, ConfigError, type PiVoiceConfig } from "./services/config.js";
import { transcribe, transcribeDetailed, prewarmGeminiClient, getActiveAppName } from "./services/stt.js";
import { _resetGeminiClient, prewarmConnection } from "./services/gemini-client.js";
import { addHistoryEntry, getHistoryEntries, clearHistory, calculateDictationCost, getMonthlyTotalCost } from "./services/history-service.js";
import { IPC, type AppState, type StatePayload, type RendererRole } from "./shared/types.js";
import { MAX_STT_PAYLOAD_BYTES, MIN_STT_PAYLOAD_BYTES, isValidWebmHeader } from "./shared/audio-utils.js";
import { saveRuntimeState, removeRuntimeState } from "./services/runtime-state.js";
import { startDaemonServer, stopDaemonServer, type DaemonCommand, type DaemonResponse } from "./services/daemon-ipc.js";
import { HotkeyService, type HotkeyCallbacks } from "./services/hotkey-service.js";
import { captureActiveSelection, createElectronClipboardAdapter, getClipboardPort, selectionOwnershipManager } from "./services/selection-service.js";
import { calculatePopoverPosition } from "./services/popover-position.js";
import { loadNativePasteAddon, resolveNativePastePath } from "./services/native-paste-addon.js";
import { createMacSafePasteService, type ClipboardAdapter } from "./services/safe-paste.js";
import { PasteCoordinator } from "./services/paste-flow.js";
import { RecordingLifecycle } from "./services/recording-lifecycle.js";
import { handleRecordingError, type RecordingErrorPayload } from "./services/recording-error.js";
import { DictationControlCoordinator, type CoordinatorActionResult } from "./services/dictation-control-coordinator.js";
import { CaptureRendererController } from "./services/capture-renderer-controller.js";
import { CaptureOrchestrator } from "./services/capture-orchestrator.js";
import logger from "./services/logger.js";

// Global process exception handlers
let isFatalShuttingDown = false;

export async function handleFatalProcessError(type: string, err: any) {
  const msg = err?.message || String(err);
  if (msg.includes("sonic boom") || msg.includes("flushSync")) return;

  logger.error({ err: msg, type }, `Fatal process error: ${type}`);

  if (isFatalShuttingDown) return;
  isFatalShuttingDown = true;

  try {
    await gracefulShutdown();
  } catch (shutdownErr: any) {
    logger.error({ err: shutdownErr?.message || String(shutdownErr) }, "Error during fatal shutdown cleanup");
  } finally {
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
  }
}

process.on("uncaughtException", (err) => {
  handleFatalProcessError("uncaughtException", err);
});

process.on("unhandledRejection", (reason) => {
  handleFatalProcessError("unhandledRejection", reason);
});

const workingCwd = process.env["PI_VOICE_CWD"] || process.cwd();
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const recordingLifecycle = new RecordingLifecycle();
export let dictationCoordinator: DictationControlCoordinator;

dictationCoordinator = new DictationControlCoordinator(
  {
    dictationMode: "toggle",
    isNativeKeyUpAvailable: () => hotkeyService?.isNativeKeyUpAvailable() ?? false,
    isFnDown: () => hotkeyService?.isFnDown() ?? false,
    onStartRecording: async (mode) => {
      currentTriggerMode = mode;
      return await startRecordingFlow();
    },
    onStopRecording: async (ensureMinimumDuration) => {
      setState("stopping", "Stopping...");
      sendToCaptureWindow(IPC.STOP_RECORDING, ensureMinimumDuration);
      return true;
    },
    onCancelDictation: (reason) => {
      cancelDictation(reason);
    },
    playStopChime: () => {
      playToggleStopChime();
    },
  },
  recordingLifecycle
);
const addonPath = resolveNativePastePath(projectRoot);
const addon = loadNativePasteAddon(addonPath);
const safePasteService = createMacSafePasteService(addon, clipboard as unknown as ClipboardAdapter<any>);
const pasteCoordinator = new PasteCoordinator((text, isCurrent, beforeWrite) => safePasteService.paste(text, isCurrent, beforeWrite));
const selectionClipboardPort = getClipboardPort(createElectronClipboardAdapter(addon?.writeClipboardBuffer));

let isQuitting = false;
let popoverWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let hotkeyService: HotkeyService | null = null;
let currentConfig: PiVoiceConfig;

export const captureOrchestrator = new CaptureOrchestrator<BrowserWindow, Electron.WebContents>(
  {
    createWindow: () => new BrowserWindow({
      width: 200,
      height: 200,
      show: false,
      focusable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: fileURLToPath(new URL("../preload/capture.cjs", import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    }),
    getWebContents: (win) => win.webContents,
    isDestroyed: (win) => win.isDestroyed(),
    destroyWindow: (win) => win.destroy(),
    onRenderProcessGone: (sender, handler) => sender.on("render-process-gone", handler),
    onDidFinishLoad: (sender, handler) => sender.once("did-finish-load", handler),
    onClosed: (win, handler) => win.on("closed", handler),
    sendIpc: (sender, channel, ...args) => sender.send(channel, ...args),
    setState: (state, msg, options) => setState(state, msg, options),
    isQuitting: () => isQuitting,
    applySecurityGuards: (win) => applyWindowSecurityGuards(win),
    loadFile: (win) => win.loadFile(fileURLToPath(new URL("../renderer/capture.html", import.meta.url))),
    captureActiveSelection: (timeoutMs, options) => captureActiveSelection(timeoutMs, options),
    capturePasteTarget: () => {
      const captured = safePasteService.captureTarget();
      if (captured) return;
      const sequenceId = recordingLifecycle.snapshot().sequenceId;
      // ponytail: one short retry lets macOS settle the global-hotkey frontmost app without weakening target checks.
      setTimeout(() => {
        const snapshot = recordingLifecycle.snapshot();
        if (snapshot.sequenceId === sequenceId && ["starting", "recording"].includes(snapshot.state)) {
          safePasteService.captureTarget();
        }
      }, 150);
    },
    playStartChime: () => playStartChime(),
    getInputGain: () => currentConfig?.inputGain ?? 1.0,
    selectionClipboardPort,
    getPopoverWindow: () => popoverWindow,
    getHudWindow: () => hudWindow,
    acknowledgeStart: (seqId, success) => dictationCoordinator.acknowledgeStart(seqId, success),
  },
  recordingLifecycle,
  pasteCoordinator
);

export const captureController = captureOrchestrator.controller;
export const captureRendererSession = captureOrchestrator.session;
export function ensureCaptureWindow() {
  return captureOrchestrator.ensureCaptureWindow();
}
export function sendToCaptureWindow(channel: string, ...args: any[]) {
  return captureOrchestrator.sendToCaptureWindow(channel, ...args);
}

let currentState: AppState = "idle";
let sequenceId = 0;
let lastPastedText = "";
let lastPasteTime = 0;

let activeSelectionText = "";

let stoppingSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function restoreCapturedSelection(sequenceId?: number) {
  const restored = selectionOwnershipManager.restoreCapturedSelection(sequenceId, selectionClipboardPort);
  activeSelectionText = "";
  return restored;
}

function isCurrentTranscription(sequenceId: number): boolean {
  const snapshot = recordingLifecycle.snapshot();
  return snapshot.sequenceId === sequenceId && snapshot.state === "transcribing";
}

let activeSelectionAbortController: AbortController | null = null;

function abortSelectionCapture() {
  activeSelectionAbortController?.abort();
  activeSelectionAbortController = null;
}

export function abortActiveFlow(failedSender?: Electron.WebContents) {
  captureOrchestrator.abortActiveFlow(failedSender);
}

function cancelDictation(reason: string = "Cancelled") {
  abortActiveFlow();

  if (currentState === "idle") {
    if (hudWindow && hudWindow.isVisible()) {
      hudWindow.hide();
    }
    return;
  }

  logger.info({ state: currentState, reason }, "Interrupting/cancelling active dictation flow");

  sendToCaptureWindow(IPC.CANCEL_RECORDING);

  playUndoChime();
  setState("idle", reason);
}

export function handleTrustLost() {
  logger.warn("Accessibility trust lost at runtime; cancelling active dictation if any and showing error state");
  if (currentState !== "idle") {
    cancelDictation("Accessibility/Input Monitoring permission revoked at runtime");
  }
  setState(
    "error",
    "Accessibility/Input Monitoring permissions required. Please grant access in System Preferences > Privacy & Security > Accessibility."
  );
}

function createHotkeyCallbacks(): HotkeyCallbacks {
  return {
    onDown: (mode) => handleHotkeyDown(mode),
    onUp: () => handleHotkeyUp(),
    onCancel: () => {
      if (currentState !== "idle") {
        cancelDictation("Cancelled via Escape key");
      }
    },
    onTrustLost: () => handleTrustLost(),
  };
}

let hudWindow: BrowserWindow | null = null;
let hudHideTimer: ReturnType<typeof setTimeout> | null = null;
let errorResetTimer: ReturnType<typeof setTimeout> | null = null;
let activeUsedPaidKey = false;
let lastStatePayload: StatePayload = { state: "idle", sequenceId: 0 };

function setState(state: AppState, message?: string, options?: { usedPaidKey?: boolean } | boolean) {
  currentState = state;
  sequenceId++;

  if (state === "starting" || state === "recording") {
    activeUsedPaidKey = false;
  }

  let usedPaidKey = typeof options === "boolean" ? options : Boolean(options?.usedPaidKey);
  if (usedPaidKey) {
    activeUsedPaidKey = true;
  } else if (activeUsedPaidKey) {
    usedPaidKey = true;
  }

  const payload: StatePayload & { hasSelection?: boolean } = {
    state,
    message,
    sequenceId,
    hasSelection: Boolean(activeSelectionText && activeSelectionText.trim().length > 0),
    usedPaidKey,
  };
  lastStatePayload = payload;
  logger.info({ state, message, sequenceId, hasSelection: payload.hasSelection, usedPaidKey: payload.usedPaidKey }, "State changed");

  if (stoppingSafetyTimer) {
    clearTimeout(stoppingSafetyTimer);
    stoppingSafetyTimer = null;
  }

  if (state === "stopping") {
    stoppingSafetyTimer = setTimeout(() => {
      if (currentState === "stopping") {
        logger.warn("Stopping state timed out, auto-resetting state machine to idle");
        const currentSeq = recordingLifecycle.snapshot().sequenceId;
        pasteCoordinator.invalidate();
        recordingLifecycle.reset();
        restoreCapturedSelection(currentSeq);
        setState("idle", "Ready");
      }
    }, 2500);
  }

  if (hudHideTimer) {
    clearTimeout(hudHideTimer);
    hudHideTimer = null;
  }

  if (errorResetTimer) {
    clearTimeout(errorResetTimer);
    errorResetTimer = null;
  }

  if (hudWindow) {
    hudWindow.webContents.send(IPC.STATE_CHANGED, payload);
    if (state === "recording" || state === "stopping" || state === "transcribing" || state === "starting" || state === "thinking" || state === "speaking" || state === "error") {
      hudWindow.showInactive();
    }
    if (state === "idle") {
      hudHideTimer = setTimeout(() => {
        if (currentState === "idle") {
          hudWindow?.hide();
        }
      }, 1500);
    } else if (state === "error") {
      hudHideTimer = setTimeout(() => {
        if (currentState === "error") {
          recordingLifecycle.settle();
          setState("idle");
        }
      }, 6000);
    }
  }

  updateTrayIconForState(state);
  sendToCaptureWindow(IPC.STATE_CHANGED, payload);
  popoverWindow?.webContents.send(IPC.STATE_CHANGED, payload);
}

let lastTrayStateTime = 0;
let trayResetTimer: ReturnType<typeof setTimeout> | null = null;

function updateTrayIconForState(state: AppState) {
  if (!tray) return;
  if (trayResetTimer) {
    clearTimeout(trayResetTimer);
    trayResetTimer = null;
  }

  const now = Date.now();
  try {
    if (state === "starting" || state === "recording") {
      lastTrayStateTime = now;
      const recIconPath = getAssetPath("tray-recording.png");
      const recIcon = nativeImage.createFromPath(recIconPath);
      recIcon.setTemplateImage(false);
      tray.setImage(recIcon);
    } else if (state === "transcribing" || state === "stopping" || state === "thinking") {
      lastTrayStateTime = now;
      const transIconPath = getAssetPath("tray-transcribing.png");
      const transIcon = nativeImage.createFromPath(transIconPath);
      transIcon.setTemplateImage(false);
      tray.setImage(transIcon);
    } else {
      const elapsed = now - lastTrayStateTime;
      const minDisplayMs = 800;
      const setIdle = () => {
        const idleIconPath = getAssetPath("tray-idleTemplate.png");
        const idleIcon = nativeImage.createFromPath(idleIconPath);
        idleIcon.setTemplateImage(true);
        tray?.setImage(idleIcon);
      };

      if (elapsed < minDisplayMs) {
        trayResetTimer = setTimeout(setIdle, minDisplayMs - elapsed);
      } else {
        setIdle();
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to update dynamic tray icon");
  }
}

function getSoundPath(soundName?: string): string {
  switch (soundName) {
    case "submarine":
      return "/System/Library/Sounds/Submarine.aiff";
    case "hero":
      return "/System/Library/Sounds/Hero.aiff";
    case "ping":
      return "/System/Library/Sounds/Ping.aiff";
    case "pop":
      return "/System/Library/Sounds/Pop.aiff";
    case "tink":
      return "/System/Library/Sounds/Tink.aiff";
    case "glass":
    default:
      return "/System/Library/Sounds/Glass.aiff";
  }
}

function playSound(soundName?: string) {
  const soundFile = getSoundPath(soundName);
  exec(`afplay "${soundFile}" 2>/dev/null`, () => {});
}

function playStartChime() {
  if (currentConfig?.audioChimesEnabled === false) return;
  playSound(currentConfig?.chimeSoundStart || "glass");
}

function playToggleStopChime() {
  if (currentConfig?.audioChimesEnabled === false) return;
  playSound(currentConfig?.chimeSoundEnd || "submarine");
}

function playSuccessChime() {
  if (currentConfig?.audioChimesEnabled === false) return;
  playSound(currentConfig?.chimeSoundEnd || "hero");
}

function playUndoChime() {
  if (currentConfig?.audioChimesEnabled === false) return;
  playSound(currentConfig?.chimeSoundEnd || "submarine");
}

function isTerminalApp(appName: string): boolean {
  const lower = appName.toLowerCase();
  return (
    lower.includes("terminal") ||
    lower.includes("warp") ||
    lower.includes("iterm") ||
    lower.includes("ghostty") ||
    lower.includes("alacritty") ||
    lower.includes("myanso") ||
    lower.includes("bash") ||
    lower.includes("zsh")
  );
}

async function executeUndoCommand(textLengthToUndo: number = 0) {
  try {
    const activeApp = await getActiveAppName();
    const isTerminal = isTerminalApp(activeApp);

    let script = "";
    if (isTerminal) {
      // Terminal Apps: Ctrl+U clears line in zsh/bash
      script = `
        tell application "System Events"
          keystroke "u" using control down
        end tell
      `;
    } else {
      // Standard GUI Apps: Cmd+Z
      script = `
        tell application "System Events"
          keystroke "z" using command down
        end tell
      `;
    }

    exec(`osascript -e '${script}'`, (err) => {
      if (err) {
        logger.error({ err: String(err) }, "Undo command failed");
      } else {
        logger.info({ activeApp, isTerminal, textLengthToUndo }, "Executed Voice Undo successfully");
        playUndoChime();
      }
    });
  } catch (err) {
    logger.error({ err: String(err) }, "Failed to execute undo command");
  }
}

function handleVoiceUndoCheck(text: string): boolean {
  const cleaned = text.toLowerCase().trim().replace(/[။.?!,"'“”‘’\-_]/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);

  if (words.length > 3) return false;

  const exactUndoKeywords = [
    "ဖျက်လိုက်",
    "ဖျက်",
    "ဖြတ်လိုက်",
    "ဖြတ်",
    "ပြန်ဖြတ်",
    "ပြန်ဖျက်",
    "undo",
    "ando",
    "2nto",
    "nto",
    "unto",
    "delete",
    "delete it",
    "delete that",
    "remove",
    "remove it",
    "remove that",
    "cut",
    "cut it",
    "cut that",
    "erase",
    "erase it",
    "clear",
    "clear it",
    "clear that",
  ];

  const isMatch = exactUndoKeywords.some((kw) => cleaned === kw || (words.length <= 2 && words.includes(kw)));

  if (isMatch) {
    const undoLength = lastPastedText ? lastPastedText.length : 0;
    logger.info({ charCount: text.length, undoLength }, "Voice Undo matched");
    executeUndoCommand(undoLength);
    lastPastedText = "";
    return true;
  }
  return false;
}



const POPOVER_SIZE = { width: 280, height: 420 } as const;

function createPopoverWindow() {
  popoverWindow = new BrowserWindow({
    width: POPOVER_SIZE.width,
    height: POPOVER_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/settings.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  applyWindowSecurityGuards(popoverWindow);

  popoverWindow.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));

  popoverWindow.on("closed", () => {
    popoverWindow = null;
  });
}

let customHudPosition: { x: number; y: number } | null = null;

function createHudWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const screenBounds = primaryDisplay.workArea;
  const width = 280;
  const height = 36;
  const defaultX = Math.round(screenBounds.x + (screenBounds.width - width) / 2);
  const defaultY = screenBounds.y + 6;

  const x = customHudPosition ? customHudPosition.x : defaultX;
  const y = customHudPosition ? customHudPosition.y : defaultY;

  hudWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    movable: true,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/hud.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  applyWindowSecurityGuards(hudWindow);

  hudWindow.loadFile(fileURLToPath(new URL("../renderer/hud.html", import.meta.url)));

  hudWindow.on("moved", () => {
    if (hudWindow) {
      const [newX, newY] = hudWindow.getPosition();
      if (newX !== undefined && newY !== undefined) {
        customHudPosition = { x: newX, y: newY };
      }
    }
  });

  hudWindow.on("closed", () => {
    hudWindow = null;
  });
}

function togglePopover(focus = false) {
  if (!popoverWindow) return;

  if (popoverWindow.isVisible()) {
    popoverWindow.hide();
  } else {
    let trayBounds = { x: 0, y: 0, width: 0, height: 0 };
    if (tray) {
      try {
        trayBounds = tray.getBounds();
      } catch {}
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const screenBounds = primaryDisplay.workArea;

    if (trayBounds.width === 0 && trayBounds.height === 0) {
      trayBounds = {
        x: Math.round(screenBounds.x + screenBounds.width / 2 - 20),
        y: screenBounds.y,
        width: 40,
        height: 24,
      };
    }

    const pos = calculatePopoverPosition(
      trayBounds,
      POPOVER_SIZE,
      screenBounds
    );

    popoverWindow.setPosition(pos.x, pos.y);
    if (focus) {
      popoverWindow.show();
      popoverWindow.focus();
    } else {
      popoverWindow.showInactive();
    }
  }
}

function getAssetPath(filename: string): string {
  const candidates = [
    join(projectRoot, "src", "assets", filename),
    join(projectRoot, "out", "src", "assets", filename),
    join(projectRoot, "assets", filename),
    join(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "assets", filename),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return join(projectRoot, "src", "assets", filename);
}

function buildTrayContextMenu(): Menu {
  const isScannerEnabled = currentConfig?.symbolScannerEnabled ?? true;
  const isChimesEnabled = currentConfig?.audioChimesEnabled !== false;

  return Menu.buildFromTemplate([
    {
      label: `vo Dictation (${currentState.toUpperCase()})`,
      enabled: false,
    },
    {
      label: currentState === "recording" ? "Stop Recording" : "Start Dictation",
      click: async () => {
        const cmd = currentState === "recording" || currentState === "starting" ? "stop" : "start";
        const res = await dictationCoordinator.handleUiCommand(cmd);
        if (!res.accepted && res.errorCode === "INPUT_MONITORING_REQUIRED") {
          setState("error", "Accessibility/Input Monitoring permissions required for Hold Mode");
        }
      },
    },
    { type: "separator" },
    {
      label: "Dynamic Symbol Scanner",
      type: "checkbox",
      checked: isScannerEnabled,
      click: (item) => {
        currentConfig = updateConfig(workingCwd, { symbolScannerEnabled: item.checked });
        popoverWindow?.webContents.send(IPC.STATE_CHANGED, {
          state: currentState,
          message: `Symbol Scanner ${item.checked ? "Enabled" : "Disabled"}`,
        });
      },
    },
    {
      label: "Audio Chimes",
      type: "checkbox",
      checked: isChimesEnabled,
      click: (item) => {
        currentConfig = updateConfig(workingCwd, { audioChimesEnabled: item.checked });
      },
    },
    { type: "separator" },
    {
      label: "Open Settings...",
      click: () => {
        if (!popoverWindow?.isVisible()) {
          togglePopover();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit vo",
      accelerator: "CmdOrCtrl+Q",
      click: () => {
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const iconPath = getAssetPath("tray-idleTemplate.png");
  logger.info({ iconPath }, "Creating tray icon");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("vo Dictation");
  tray.on("click", () => togglePopover());
  tray.on("right-click", () => {
    if (tray) {
      tray.popUpContextMenu(buildTrayContextMenu());
    }
  });
}



export function enforceIpcSender(
  event: IpcMainInvokeEvent | Electron.IpcMainEvent,
  channel: string
) {
  const result = validateIpcSenderPolicy(event, channel, popoverWindow, captureController.getCaptureWindow(), hudWindow);
  if (result.role === "capture" && !captureRendererSession.isAvailable(event.sender)) {
    throw new Error(`Unauthorized IPC sender: capture session not available or stale for channel '${channel}'`);
  }
  return result;
}

function validateIpcSender(
  event: IpcMainInvokeEvent | Electron.IpcMainEvent,
  channel: string
): { role: RendererRole; window: BrowserWindow } | null {
  try {
    return enforceIpcSender(event, channel);
  } catch (err: any) {
    logger.warn({ channel, err: err?.message }, "Denied unauthorized IPC sender");
    return null;
  }
}

function hotkeyRegistrationError(): string | null {
  const state = recordingLifecycle.snapshot().state;
  return state === "idle" || state === "error"
    ? null
    : "Hotkeys can only be changed while dictation is idle or in a recoverable error state";
}

function setupIpcHandlers() {
  ipcMain.on(IPC.RECORDING_DATA, async (event, data: unknown) => {
    if (!validateIpcSender(event, IPC.RECORDING_DATA)) return;
    if (currentState !== "recording" && currentState !== "stopping") return;

    const currentSeq = recordingLifecycle.snapshot().sequenceId;

    if (!data || typeof data !== "object") {
      logger.warn("Received invalid recording data payload type");
      sendToCaptureWindow(IPC.CANCEL_RECORDING);
      captureOrchestrator.markCaptureInactive(currentSeq);
      pasteCoordinator.invalidate();
      recordingLifecycle.reset();
      restoreCapturedSelection(currentSeq);
      setState("error", "Invalid recording payload type");
      return;
    }

    const rawByteLength = (data as any)?.byteLength;
    if (typeof rawByteLength !== "number" || rawByteLength < MIN_STT_PAYLOAD_BYTES) {
      sendToCaptureWindow(IPC.CANCEL_RECORDING);
      captureOrchestrator.markCaptureInactive(currentSeq);
      pasteCoordinator.invalidate();
      recordingLifecycle.reset();
      restoreCapturedSelection(currentSeq);
      setState("idle", "Recording too short");
      return;
    }

    if (rawByteLength > MAX_STT_PAYLOAD_BYTES) {
      sendToCaptureWindow(IPC.CANCEL_RECORDING);
      captureOrchestrator.markCaptureInactive(currentSeq);
      pasteCoordinator.invalidate();
      recordingLifecycle.reset();
      restoreCapturedSelection(currentSeq);
      setState("error", "Recording payload too large");
      return;
    }

    let arrayBuffer: ArrayBuffer;
    try {
      if (data instanceof ArrayBuffer) {
        arrayBuffer = data;
      } else if (ArrayBuffer.isView(data)) {
        const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        arrayBuffer = new Uint8Array(view).buffer as ArrayBuffer;
      } else {
        throw new Error("Invalid payload type");
      }
    } catch {
      logger.warn("Failed to convert recording payload to ArrayBuffer");
      sendToCaptureWindow(IPC.CANCEL_RECORDING);
      captureOrchestrator.markCaptureInactive(currentSeq);
      pasteCoordinator.invalidate();
      recordingLifecycle.reset();
      restoreCapturedSelection(currentSeq);
      setState("error", "Invalid recording payload type");
      return;
    }

    if (arrayBuffer.byteLength < MIN_STT_PAYLOAD_BYTES) {
      sendToCaptureWindow(IPC.CANCEL_RECORDING);
      captureOrchestrator.markCaptureInactive(currentSeq);
      pasteCoordinator.invalidate();
      recordingLifecycle.reset();
      restoreCapturedSelection(currentSeq);
      setState("idle", "Recording too short");
      return;
    }

    if (arrayBuffer.byteLength > MAX_STT_PAYLOAD_BYTES) {
      sendToCaptureWindow(IPC.CANCEL_RECORDING);
      captureOrchestrator.markCaptureInactive(currentSeq);
      pasteCoordinator.invalidate();
      recordingLifecycle.reset();
      restoreCapturedSelection(currentSeq);
      setState("error", "Recording payload too large");
      return;
    }

    if (!isValidWebmHeader(arrayBuffer)) {
      sendToCaptureWindow(IPC.CANCEL_RECORDING);
      captureOrchestrator.markCaptureInactive(currentSeq);
      pasteCoordinator.invalidate();
      recordingLifecycle.reset();
      restoreCapturedSelection(currentSeq);
      setState("error", "Malformed recording payload (missing WebM header)");
      return;
    }

    const ackStop = recordingLifecycle.acknowledgeStop(currentSeq, true);
    if (!ackStop.accepted) {
      logger.warn("Received recording data for invalid lifecycle sequence");
      return;
    }

    const sttAbortController = captureOrchestrator.createSTTAbortController();

    try {
      setState("transcribing", "Transcribing...", { usedPaidKey: activeUsedPaidKey });
      const { text, usedPaidKey, modelUsed } = await transcribeDetailed(arrayBuffer, {
        provider: currentConfig.provider,
        geminiModel: currentConfig.geminiModel,
        dictationPreset: currentConfig.dictationPreset,
        translateEnabled: currentConfig.translateEnabled,
        targetLanguage: currentConfig.targetLanguage,
        customVocabulary: currentConfig.customVocabulary,
        presetVocabulary: currentConfig.presetVocabulary,
        dictionaryEntries: currentConfig.dictionaryEntries,
        symbolScannerEnabled: currentConfig.symbolScannerEnabled,
        selectedText: activeSelectionText,
        abortSignal: sttAbortController.signal,
      });

      const transcriptionSnapshot = recordingLifecycle.snapshot();
      if (transcriptionSnapshot.sequenceId !== currentSeq || transcriptionSnapshot.state !== "transcribing") {
        logger.warn({ currentSeq, snapshot: transcriptionSnapshot }, "Discarding stale transcription result");
        return;
      }

      if (!text || text.trim().length === 0) {
        recordingLifecycle.finishTranscription(currentSeq, true);
        restoreCapturedSelection(currentSeq);
        setState("idle", "No speech detected", { usedPaidKey });
        return;
      }

      if (usedPaidKey) {
        logger.warn({ modelUsed }, "STT transcription executed via Paid Fallback Key!");
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: "💳 Paid Gemini Key Used",
              body: "Primary free keys were rate-limited or exhausted. Fallback paid key was used.",
            }).show();
          }
        } catch {}
      }

      logger.info({ charCount: text.length, usedPaidKey }, "STT transcription successful");

      const isUndo = handleVoiceUndoCheck(text);
      if (isUndo) {
        recordingLifecycle.finishTranscription(currentSeq, true);
        restoreCapturedSelection(currentSeq);
        setState("idle", "Voice undo executed", { usedPaidKey });
        return;
      }

      const activeApp = await getActiveAppName();
      if (!isCurrentTranscription(currentSeq)) {
        logger.warn({ currentSeq }, "Discarding stale paste attempt after active-app lookup");
        return;
      }

      const audioDurationSec = Math.max(1, Math.round(data.byteLength / 4000));
      const isBurmeseText = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(text);
      const isEnglish = !isBurmeseText;
      const cost = calculateDictationCost(audioDurationSec, text.length, modelUsed || currentConfig.geminiModel, isEnglish);

      if (!isCurrentTranscription(currentSeq)) {
        logger.warn({ currentSeq }, "Discarding stale paste attempt before paste coordinator");
        return;
      }

      const pasteResult = await pasteCoordinator.pasteText(
        text,
        currentSeq,
        isCurrentTranscription,
        () => restoreCapturedSelection(currentSeq),
      );

      if (!isCurrentTranscription(currentSeq) || pasteResult.status === "stale") {
        logger.warn({ currentSeq, pasteResult }, "Discarding stale paste result");
        return;
      }

      if (pasteResult.status === "submitted") {
        recordingLifecycle.finishTranscription(currentSeq, true);
        restoreCapturedSelection(currentSeq);
        addHistoryEntry(text, activeApp, cost, audioDurationSec, modelUsed || currentConfig.geminiModel, usedPaidKey);
        lastPastedText = text;
        lastPasteTime = Date.now();
        playSuccessChime();
        setState("idle", "Dictation successful", { usedPaidKey });
      } else {
        recordingLifecycle.finishTranscription(currentSeq, false);
        recordingLifecycle.settle();
        restoreCapturedSelection(currentSeq);
        addHistoryEntry(text, activeApp, cost, audioDurationSec, modelUsed || currentConfig.geminiModel, usedPaidKey);
        logger.warn({ pasteResult }, "Target window changed or paste denied - transcript saved to history");
        setState("idle", "Target changed - transcript saved to history", { usedPaidKey });
      }
    } catch (err: any) {
      if (!isCurrentTranscription(currentSeq)) return;
      recordingLifecycle.finishTranscription(currentSeq, false);
      restoreCapturedSelection(currentSeq);
      logger.error({ err: err.message }, "Transcription failed");
      setState("error", err.message);
      errorResetTimer = setTimeout(() => {
        if (currentState === "error") {
          recordingLifecycle.settle();
          setState("idle");
        }
      }, 6000);
    } finally {
      if (captureOrchestrator.activeSTTAbortController === sttAbortController) {
        captureOrchestrator.activeSTTAbortController = null;
      }
    }
  });

  ipcMain.on(IPC.CANCEL_DICTATION, (event) => {
    if (!validateIpcSender(event, IPC.CANCEL_DICTATION)) return;
    cancelDictation("Cancelled via user interface");
  });

  ipcMain.on(IPC.RECORDING_ERROR, (event, payload: RecordingErrorPayload) => {
    if (!validateIpcSender(event, IPC.RECORDING_ERROR)) return;
    captureOrchestrator.markCaptureInactive((payload as any)?.sequenceId);
    if (handleRecordingError(
      payload,
      recordingLifecycle,
      () => pasteCoordinator.invalidate(),
      restoreCapturedSelection,
      (message) => {
        logger.warn({ error: message }, "Recording warning");
        setState("error", message);
      },
    )) return;
  });

  ipcMain.on(IPC.RECORDING_START_READY, (event, payload: { sequenceId: number; deviceStatus?: string }) => {
    void (async () => {
      if (!validateIpcSender(event, IPC.RECORDING_START_READY)) return;
      const seq = payload?.sequenceId;
      const currentSnapshot = recordingLifecycle.snapshot();
      if (!Number.isSafeInteger(seq) || seq !== currentSnapshot.sequenceId || (currentSnapshot.state !== "starting" && currentSnapshot.state !== "recording")) {
        logger.warn({ seq, currentSnapshot }, "Received start-ready for invalid sequence or state");
        return;
      }

      const deviceStatus = typeof payload?.deviceStatus === "string" && payload.deviceStatus.length > 0 && payload.deviceStatus.length < 256
        ? payload.deviceStatus
        : undefined;

      if (deviceStatus) {
        captureOrchestrator.setSequenceDeviceStatus(seq, deviceStatus);
      }

      if (currentSnapshot.state === "starting") {
        await dictationCoordinator.acknowledgeStart(seq, true);
      }

      if (recordingLifecycle.snapshot().sequenceId === seq && currentState === "recording") {
        const finalStatus = captureOrchestrator.getSequenceDeviceStatus(seq) || deviceStatus;
        if (finalStatus) {
          setState("recording", finalStatus);
        }
      }
    })().catch((err: any) => {
      logger.error({ err: err?.message || String(err) }, "Error in RECORDING_START_READY handler");
    });
  });

  ipcMain.on(IPC.RECORDING_START_FAILED, (event, payload: { sequenceId: number; error: string }) => {
    if (!validateIpcSender(event, IPC.RECORDING_START_FAILED)) return;
    const seq = payload?.sequenceId;
    captureOrchestrator.markCaptureInactive(seq);
    if (typeof seq === "number") {
      dictationCoordinator.acknowledgeStart(seq, false);
      handleRecordingError(
        payload,
        recordingLifecycle,
        () => pasteCoordinator.invalidate(),
        restoreCapturedSelection,
        (message) => {
          logger.warn({ error: message }, "Recording start failed");
          setState("error", message);
        }
      );
    }
  });

  ipcMain.on(IPC.RECORDING_STOPPED, (event, payload: { sequenceId: number }) => {
    if (!validateIpcSender(event, IPC.RECORDING_STOPPED)) return;
    captureOrchestrator.markCaptureInactive(payload?.sequenceId);
  });

  ipcMain.on(IPC.AUDIO_LEVEL_UPDATE, (event, level: number) => {
    if (!validateIpcSender(event, IPC.AUDIO_LEVEL_UPDATE)) return;
    popoverWindow?.webContents.send(IPC.AUDIO_LEVEL_UPDATE, level);
    hudWindow?.webContents.send(IPC.AUDIO_LEVEL_UPDATE, level);
  });

  ipcMain.handle(IPC.STATE_SNAPSHOT, (event) => {
    enforceIpcSender(event, IPC.STATE_SNAPSHOT);
    return lastStatePayload;
  });

  ipcMain.handle(IPC.GET_CONFIG, (event) => {
    const sender = enforceIpcSender(event, IPC.GET_CONFIG);
    if (sender.role === "capture") {
      return getCaptureConfigPayload(currentConfig);
    }
    return getSanitizedSettingsConfig(currentConfig);
  });

  ipcMain.handle(IPC.SAVE_CONFIG, async (event, patch) => {
    enforceIpcSender(event, IPC.SAVE_CONFIG);
    const validatedPatch = configPatchSchema.parse(patch);
    const previousDictationMode = currentConfig.dictationMode;
    const modeChanged = validatedPatch.dictationMode && validatedPatch.dictationMode !== previousDictationMode;
    if (modeChanged && !["idle", "error"].includes(recordingLifecycle.snapshot().state)) {
      throw new Error("Dictation mode can only be changed while recording is idle");
    }
    currentConfig = updateConfig(workingCwd, validatedPatch);
    dictationCoordinator.setDictationMode(currentConfig.dictationMode);
    if (hotkeyService && modeChanged) {
      await hotkeyService.stop();
      const hotkeyRes = await hotkeyService.start(
        currentConfig.key,
        createHotkeyCallbacks(),
        currentConfig.editKey,
        currentConfig.dictationMode
      );
      if (!hotkeyRes.success) {
        currentConfig = updateConfig(workingCwd, { dictationMode: previousDictationMode });
        dictationCoordinator.setDictationMode(previousDictationMode);
        await hotkeyService.stop();
        const restoreRes = await hotkeyService.start(
          currentConfig.key,
          createHotkeyCallbacks(),
          currentConfig.editKey,
          previousDictationMode
        );
        if (!restoreRes.success) {
          logger.error({ error: restoreRes.error }, "Failed to restore hotkeys after dictation mode change");
        }
        throw new Error(hotkeyRes.error || "Hotkey registration failed after dictation mode change");
      }
    }
    if (validatedPatch.geminiApiKey !== undefined) {
      process.env.GEMINI_API_KEY = (currentConfig.geminiApiKey || "").trim();
      _resetGeminiClient();
    }
    if (validatedPatch.inputGain !== undefined) {
      sendToCaptureWindow(IPC.GAIN_UPDATE, currentConfig.inputGain);
    }
    return getSanitizedSettingsConfig(currentConfig);
  });

  ipcMain.handle(IPC.GET_HISTORY, (event) => {
    enforceIpcSender(event, IPC.GET_HISTORY);
    return getHistoryEntries();
  });

  ipcMain.handle(IPC.CLEAR_HISTORY, (event) => {
    enforceIpcSender(event, IPC.CLEAR_HISTORY);
    clearHistory();
    return [];
  });

  ipcMain.handle(IPC.TOGGLE_DICTATION, async (event) => {
    enforceIpcSender(event, IPC.TOGGLE_DICTATION);
    const res = await dictationCoordinator.handleUiCommand("toggle");
    if (!res.accepted && res.errorCode === "INPUT_MONITORING_REQUIRED") {
      setState("error", "Accessibility/Input Monitoring permissions required for Hold Mode");
    }
    return { success: res.accepted, error: res.reason };
  });

  ipcMain.handle(IPC.PREVIEW_CHIME, (event, soundName: string) => {
    enforceIpcSender(event, IPC.PREVIEW_CHIME);
    playSound(soundName);
    return { success: true };
  });

  ipcMain.handle(IPC.TEST_API_KEY, async (event, keyToTest?: string) => {
    enforceIpcSender(event, IPC.TEST_API_KEY);
    try {
      const validatedKey = z.string().min(1).max(256).optional().parse(keyToTest);
      const targetKey = validatedKey || currentConfig.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!targetKey) {
        return { success: false, error: "No API Key provided" };
      }

      const keys = targetKey.split(/[,\n]+/).map((k) => k.trim()).filter((k) => k.length > 0 && !k.includes("your_"));
      const firstKey = keys[0] || targetKey.trim();

      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({ apiKey: firstKey });
      const res = await client.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: "Ping",
      });
      if (res && res.text !== undefined) {
        currentConfig = updateConfig(workingCwd, { geminiApiKey: targetKey });
        process.env.GEMINI_API_KEY = firstKey;
        _resetGeminiClient();
        return { success: true, message: keys.length > 1 ? `${keys.length} API Keys are valid & saved!` : "API Key is valid & saved!" };
      }
      return { success: false, error: "Empty response from Gemini API" };
    } catch (err: any) {
      return { success: false, error: err.message || "Invalid API Key" };
    }
  });

  ipcMain.handle(IPC.REGISTER_HOTKEY, async (event, newKeyStr: string) => {
    enforceIpcSender(event, IPC.REGISTER_HOTKEY);
    const registrationError = hotkeyRegistrationError();
    if (registrationError) return { success: false, error: registrationError };
    if (!hotkeyService) return { success: false, error: "Hotkey service not initialized" };

    const res = await hotkeyService.replace(
      newKeyStr,
      createHotkeyCallbacks(),
      formatKeyBinding(currentConfig.editKey),
      currentConfig.dictationMode
    );
    if (res.success && res.binding) {
      currentConfig = updateConfig(workingCwd, { key: newKeyStr });
    }
    return res;
  });

  ipcMain.handle(IPC.REGISTER_EDIT_HOTKEY, async (event, newKeyStr: string) => {
    enforceIpcSender(event, IPC.REGISTER_EDIT_HOTKEY);
    const registrationError = hotkeyRegistrationError();
    if (registrationError) return { success: false, error: registrationError };
    if (!hotkeyService) return { success: false, error: "Hotkey service not initialized" };

    try {
      const binding = parseKeyBinding(newKeyStr);
      const res = await hotkeyService.start(
        currentConfig.key,
        createHotkeyCallbacks(),
        binding,
        currentConfig.dictationMode
      );
      if (!res.success) return res;
      currentConfig = updateConfig(workingCwd, { editKey: newKeyStr });
      return { ...res, binding, keyDisplay: currentConfig.editKeyDisplay };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

let lastHotkeyDownTime = 0;
let currentTriggerMode: "dictate" | "edit" = "dictate";

export async function startRecordingFlow(): Promise<boolean> {
  captureOrchestrator.currentTriggerMode = currentTriggerMode;
  return captureOrchestrator.startRecordingFlow();
}

export function handleHotkeyDown(mode: "dictate" | "edit" = "dictate"): Promise<CoordinatorActionResult> {
  const now = Date.now();
  const dictMode = dictationCoordinator.getDictationMode();
  const currentState = dictationCoordinator.snapshot().state;
  const isHoldModeInitial = dictMode === "hold" && (currentState === "idle" || currentState === "error");

  if (!isHoldModeInitial && now - lastHotkeyDownTime < 350) {
    logger.warn({ deltaMs: now - lastHotkeyDownTime }, "Debounced duplicate hotkey down trigger");
    return Promise.resolve({ accepted: false, action: "ignored", reason: "Debounced duplicate keydown" });
  }
  lastHotkeyDownTime = now;

  prewarmConnection();

  return dictationCoordinator.handlePhysicalDown(mode).then((res) => {
    if (!res.accepted && res.errorCode === "INPUT_MONITORING_REQUIRED") {
      setState("error", "Accessibility/Input Monitoring permissions required for Hold Mode");
    }
    return res;
  });
}

export function handleHotkeyUp(): Promise<CoordinatorActionResult> {
  return dictationCoordinator.handlePhysicalUp();
}

export function toggleRecordingState(): Promise<CoordinatorActionResult> {
  return dictationCoordinator.handleUiCommand("toggle").then((res) => {
    if (!res.accepted && res.errorCode === "INPUT_MONITORING_REQUIRED") {
      setState("error", "Accessibility/Input Monitoring permissions required for Hold Mode");
    }
    return res;
  });
}

export function setDictationCoordinatorForTests(coordinator: DictationControlCoordinator): void {
  dictationCoordinator = coordinator;
}

export function createMainHotkeyCallbacks(): HotkeyCallbacks {
  return {
    onDown: (mode) => {
      handleHotkeyDown(mode);
    },
    onUp: () => {
      handleHotkeyUp();
    },
  };
}

function handleDaemonCommand(command: DaemonCommand): DaemonResponse {
  switch (command) {
    case "status":
      return {
        ok: true,
        state: currentState,
        cwd: workingCwd,
        pid: process.pid,
        uptime: process.uptime(),
      };
    case "show":
      togglePopover();
      return { ok: true };
    case "cancel":
    case "interrupt":
      cancelDictation("Cancelled via CLI command");
      return { ok: true };
    case "stop":
    case "shutdown":
      setImmediate(() => {
        gracefulShutdown().finally(() => {
          app.quit();
        });
      });
      return { ok: true };
    default:
      return { ok: false, error: `Unknown command: ${command}` };
  }
}

function withBoundedWait<T>(promise: Promise<T>, timeoutMs: number): Promise<T | void> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

let shutdownPromise: Promise<void> | null = null;

export function gracefulShutdown(): Promise<void> {
  isQuitting = true;
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    logger.info("Shutting down...");

    pasteCoordinator.invalidate();
    abortSelectionCapture();

    try {
      captureOrchestrator.abortActiveFlow();
    } catch (err: any) {
      logger.warn({ err: err?.message || String(err) }, "Error aborting active capture flow during shutdown");
    }

    try {
      dictationCoordinator?.reset();
    } catch {}

    const currentSeq = recordingLifecycle.snapshot().sequenceId;
    recordingLifecycle.reset();

    try {
      await withBoundedWait(captureOrchestrator.teardownCaptureWindow(), 2000);
    } catch (err: any) {
      logger.warn({ err: err?.message || String(err) }, "Error tearing down capture window during shutdown");
    }

    try {
      restoreCapturedSelection(currentSeq);
    } catch (err: any) {
      logger.warn({ err: err?.message || String(err) }, "Error restoring selection during shutdown");
    }

    if (stoppingSafetyTimer) {
      clearTimeout(stoppingSafetyTimer);
      stoppingSafetyTimer = null;
    }
    if (hudHideTimer) {
      clearTimeout(hudHideTimer);
      hudHideTimer = null;
    }
    if (errorResetTimer) {
      clearTimeout(errorResetTimer);
      errorResetTimer = null;
    }
    if (trayResetTimer) {
      clearTimeout(trayResetTimer);
      trayResetTimer = null;
    }

    if (hudWindow && !hudWindow.isDestroyed()) {
      try { hudWindow.destroy(); } catch {}
      hudWindow = null;
    }

    if (popoverWindow && !popoverWindow.isDestroyed()) {
      try { popoverWindow.destroy(); } catch {}
      popoverWindow = null;
    }

    if (tray) {
      try { tray.destroy(); } catch {}
      tray = null;
    }

    if (hotkeyService) {
      try {
        await withBoundedWait(hotkeyService.stop(), 1000);
      } catch (err: any) {
        logger.warn({ err: err?.message || String(err) }, "Error stopping hotkeys during shutdown");
      }
    }

    try {
      await withBoundedWait(stopDaemonServer(), 1000);
    } catch (err: any) {
      logger.warn({ err: err?.message || String(err) }, "Error stopping daemon server during shutdown");
    }

    removeRuntimeState();
    logger.info("Graceful shutdown complete.");
  })();

  return shutdownPromise;
}

export function _resetShutdownStateForTests(): void {
  shutdownPromise = null;
  isFatalShuttingDown = false;
  isQuitting = false;
}

const gotSingleInstanceLock = process.argv.includes("--headless") || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock && !process.argv.includes("--headless")) {
  logger.info("Another instance of vo is already running, quitting second instance");
  app.quit();
} else {
  app.on("second-instance", () => {
    logger.info("Second instance launched, focusing popover window");
    if (popoverWindow) {
      if (popoverWindow.isVisible()) {
        popoverWindow.focus();
      } else {
        togglePopover(true);
      }
    }
  });
}

export async function runStartupSequence(cwd: string = workingCwd): Promise<boolean> {
  try {
    try {
      currentConfig = loadConfig(cwd);
    } catch (err: any) {
      logger.warn({ err: err?.message || String(err) }, "Config error during startup, using defaultConfig");
      currentConfig = defaultConfig();
    }

    dictationCoordinator.setDictationMode(currentConfig.dictationMode);

    setupIpcHandlers();

    hotkeyService = new HotkeyService();
    const hotkeyRes = await hotkeyService.start(
      currentConfig.key,
      createHotkeyCallbacks(),
      currentConfig.editKey,
      currentConfig.dictationMode
    );

    if (!hotkeyRes.success) {
      logger.warn({ error: hotkeyRes.error }, "Hotkey registration reported optional degradation on startup");
    }

    prewarmGeminiClient();
    await stopDaemonServer();
    await startDaemonServer(handleDaemonCommand);
    saveRuntimeState(cwd);

    ensureCaptureWindow();
    createPopoverWindow();
    createHudWindow();
    createTray();

    logger.info({ cwd, provider: currentConfig.provider, geminiModel: currentConfig.geminiModel, dictationMode: currentConfig.dictationMode }, "vo daemon started successfully");
    return true;
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Fatal error during application startup; cleaning up and exiting");
    await gracefulShutdown();
    app.exit(1);
    return false;
  }
}

app.whenReady().then(async () => {
  if (process.env.NODE_ENV === "test") return;
  if (!gotSingleInstanceLock && !process.argv.includes("--headless")) return;

  if (process.argv.includes("--headless")) {
    const isOk = addon !== null && typeof addon.selfCheck === "function" && addon.selfCheck() === true;
    if (isOk) {
      console.log("native paste addon self-check ok");
      app.exit(0);
      return;
    }
    console.error("native paste addon self-check failed");
    app.exit(1);
    return;
  }

  app.name = "vo";
  app.setName("vo");

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (ev, url) => {
      ev.preventDefault();
      logger.warn({ url }, "Blocked unexpected webContents navigation");
    });

    contents.setWindowOpenHandler(({ url }) => {
      logger.warn({ url }, "Blocked unexpected webContents window creation");
      return { action: "deny" };
    });

    if (typeof (contents as any).on === "function") {
      (contents as any).on("will-attach-webview", (ev: any) => {
        ev.preventDefault();
        logger.warn("Blocked unexpected webContents webview attachment");
      });
    }
  });

  if (app.dock) {
    app.dock.hide();
  }

  await runStartupSequence();
});

app.on("window-all-closed", () => {});
app.on("before-quit", (event) => {
  if (!gotSingleInstanceLock && !process.argv.includes("--headless")) return;
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    gracefulShutdown().finally(() => {
      app.quit();
    });
  }
});
