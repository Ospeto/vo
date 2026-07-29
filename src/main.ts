import { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, clipboard, Notification, type IpcMainInvokeEvent } from "electron";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, updateConfig, parseKeyBinding, formatKeyBinding, defaultConfig, ConfigError, type PiVoiceConfig } from "./services/config.js";
import { transcribe, transcribeDetailed, prewarmGeminiClient, getActiveAppName } from "./services/stt.js";
import { _resetGeminiClient, prewarmConnection } from "./services/gemini-client.js";
import { addHistoryEntry, getHistoryEntries, clearHistory, calculateDictationCost, getMonthlyTotalCost } from "./services/history-service.js";
import { IPC, type AppState, type StatePayload } from "./shared/types.js";
import { saveRuntimeState, removeRuntimeState } from "./services/runtime-state.js";
import { startDaemonServer, stopDaemonServer, type DaemonCommand, type DaemonResponse } from "./services/daemon-ipc.js";
import { HotkeyService } from "./services/hotkey-service.js";
import { captureActiveSelection, createElectronClipboardAdapter, getClipboardPort, restoreClipboard } from "./services/selection-service.js";
import { calculatePopoverPosition } from "./services/popover-position.js";
import { loadNativePasteAddon, resolveNativePastePath } from "./services/native-paste-addon.js";
import { createMacSafePasteService, type ClipboardAdapter, type ClipboardSnapshot } from "./services/safe-paste.js";
import { PasteCoordinator } from "./services/paste-flow.js";
import { RecordingLifecycle } from "./services/recording-lifecycle.js";
import { MINIMUM_HOLD_RECORDING_MS, SHORT_TAP_THRESHOLD_MS, getHoldModeMinimumDuration, shouldEnsureMinimumDuration } from "./services/hold-mode-protections.js";
import logger from "./services/logger.js";

// Global process exception handlers
process.on("uncaughtException", (err) => {
  const msg = err?.message || String(err);
  if (msg.includes("sonic boom") || msg.includes("flushSync")) return;
  logger.error({ err: msg }, "Uncaught main process exception");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason: String(reason) }, "Unhandled promise rejection");
});

const workingCwd = process.env["PI_VOICE_CWD"] || process.cwd();
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const recordingLifecycle = new RecordingLifecycle();
const addonPath = resolveNativePastePath(projectRoot);
const addon = loadNativePasteAddon(addonPath);
const safePasteService = createMacSafePasteService(addon, clipboard as unknown as ClipboardAdapter<any>);
const pasteCoordinator = new PasteCoordinator((text, isCurrent) => safePasteService.paste(text, isCurrent));
const selectionClipboardPort = getClipboardPort(createElectronClipboardAdapter(addon?.writeClipboardBuffer));

let captureWindow: BrowserWindow | null = null;
let popoverWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let hotkeyService: HotkeyService | null = null;
let currentConfig: PiVoiceConfig;

let currentState: AppState = "idle";
let sequenceId = 0;
let lastPastedText = "";
let lastPasteTime = 0;

let activeSelectionText = "";
let previousClipboardContent: ClipboardSnapshot | string = "";
let selectionCaptured = false;

let stoppingSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function restoreCapturedSelection() {
  if (selectionCaptured) restoreClipboard(previousClipboardContent, selectionClipboardPort);
  previousClipboardContent = "";
  activeSelectionText = "";
  selectionCaptured = false;
}

function isCurrentTranscription(sequenceId: number): boolean {
  const snapshot = recordingLifecycle.snapshot();
  return snapshot.sequenceId === sequenceId && snapshot.state === "transcribing";
}

let activeSTTAbortController: AbortController | null = null;
let activeSelectionAbortController: AbortController | null = null;

function abortSelectionCapture() {
  activeSelectionAbortController?.abort();
  activeSelectionAbortController = null;
}

function cancelDictation(reason: string = "Cancelled") {
  abortSelectionCapture();
  if (currentState === "idle") {
    if (hudWindow && hudWindow.isVisible()) {
      hudWindow.hide();
    }
    return;
  }

  logger.info({ state: currentState, reason }, "Interrupting/cancelling active dictation flow");

  if (activeSTTAbortController) {
    activeSTTAbortController.abort();
    activeSTTAbortController = null;
  }

  pasteCoordinator.invalidate();
  recordingLifecycle.cancel();
  restoreCapturedSelection();

  captureWindow?.webContents.send(IPC.CANCEL_RECORDING);

  playUndoChime();
  setState("idle", reason);
}

let hudWindow: BrowserWindow | null = null;
let hudHideTimer: ReturnType<typeof setTimeout> | null = null;
let activeUsedPaidKey = false;

function setState(state: AppState, message?: string, options?: { usedPaidKey?: boolean } | boolean) {
  currentState = state;
  sequenceId++;

  const isPaidConfigured = Boolean(
    currentConfig?.geminiFallbackApiKey && currentConfig.geminiFallbackApiKey.trim()
  ) || currentConfig?.provider === "openai" || currentConfig?.provider === "elevenlabs";

  let usedPaidKey = typeof options === "boolean" ? options : Boolean(options?.usedPaidKey);

  if (state === "starting" || state === "recording") {
    if (!isPaidConfigured) {
      activeUsedPaidKey = false;
    }
  }

  if (usedPaidKey) {
    activeUsedPaidKey = true;
  } else if (activeUsedPaidKey || isPaidConfigured) {
    usedPaidKey = true;
  }

  const payload: StatePayload & { hasSelection?: boolean } = {
    state,
    message,
    sequenceId,
    hasSelection: Boolean(activeSelectionText && activeSelectionText.trim().length > 0),
    usedPaidKey,
  };
  logger.info({ state, message, sequenceId, hasSelection: payload.hasSelection, usedPaidKey: payload.usedPaidKey }, "State changed");

  if (stoppingSafetyTimer) {
    clearTimeout(stoppingSafetyTimer);
    stoppingSafetyTimer = null;
  }

  if (state === "stopping") {
    stoppingSafetyTimer = setTimeout(() => {
      if (currentState === "stopping") {
        logger.warn("Stopping state timed out, auto-resetting state machine to idle");
        pasteCoordinator.invalidate();
        recordingLifecycle.reset();
        restoreCapturedSelection();
        setState("idle", "Ready");
      }
    }, 2500);
  }

  if (hudHideTimer) {
    clearTimeout(hudHideTimer);
    hudHideTimer = null;
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
  captureWindow?.webContents.send(IPC.STATE_CHANGED, payload);
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
  if (currentConfig.audioChimesEnabled === false) return;
  playSound(currentConfig.chimeSoundStart || "glass");
}

function playToggleStopChime() {
  if (currentConfig.audioChimesEnabled === false) return;
  playSound(currentConfig.chimeSoundEnd || "submarine");
}

function playSuccessChime() {
  if (currentConfig.audioChimesEnabled === false) return;
  playSound(currentConfig.chimeSoundEnd || "hero");
}

function playUndoChime() {
  if (currentConfig.audioChimesEnabled === false) return;
  playSound(currentConfig.chimeSoundEnd || "submarine");
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
  const cleaned = text.toLowerCase().trim().replace(/[။\.\?!,"'“”‘’\-_]/g, "");
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
    logger.info({ text, cleaned, undoLength }, "Voice Undo matched");
    executeUndoCommand(undoLength);
    lastPastedText = "";
    return true;
  }
  return false;
}

function createCaptureWindow() {
  captureWindow = new BrowserWindow({
    width: 200,
    height: 200,
    show: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  captureWindow.loadFile(fileURLToPath(new URL("../renderer/capture.html", import.meta.url)));

  captureWindow.webContents.on("render-process-gone", (_event, details) => {
    logger.error({ details }, "Capture renderer process crashed, auto-recovering...");
    setState("idle", "Capture engine recovered");
    createCaptureWindow();
  });

  captureWindow.on("closed", () => {
    captureWindow = null;
  });
}

function createPopoverWindow() {
  popoverWindow = new BrowserWindow({
    width: 390,
    height: 560,
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
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
      { width: 390, height: 560 },
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
      click: () => {
        handleHotkeyDown();
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

function validateIpcSender(event: IpcMainInvokeEvent | Electron.IpcMainEvent, allowHud = false): boolean {
  const senderId = event.sender.id;
  const isCapture = captureWindow && senderId === captureWindow.webContents.id;
  const isPopover = popoverWindow && senderId === popoverWindow.webContents.id;
  const isHud = allowHud && hudWindow && senderId === hudWindow.webContents.id;
  return Boolean(isCapture || isPopover || isHud);
}

function setupIpcHandlers() {
  ipcMain.on(IPC.RECORDING_DATA, async (event, data: ArrayBuffer) => {
    if (!validateIpcSender(event)) return;
    if (currentState !== "recording" && currentState !== "stopping") return;

    if (data.byteLength < 1000) {
      pasteCoordinator.invalidate();
      recordingLifecycle.reset();
      restoreCapturedSelection();
      setState("idle", "Recording too short");
      return;
    }

    const currentSeq = recordingLifecycle.snapshot().sequenceId;
    const ackStop = recordingLifecycle.acknowledgeStop(currentSeq, true);
    if (!ackStop.accepted) {
      logger.warn("Received recording data for invalid lifecycle sequence");
      return;
    }

    const sttAbortController = new AbortController();
    activeSTTAbortController = sttAbortController;

    try {
      setState("transcribing", "Transcribing...", { usedPaidKey: activeUsedPaidKey });
      const { text, usedPaidKey, modelUsed } = await transcribeDetailed(data, {
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
        restoreCapturedSelection();
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

      logger.info({ text, usedPaidKey }, "STT transcription successful");

      const isUndo = handleVoiceUndoCheck(text);
      if (isUndo) {
        recordingLifecycle.finishTranscription(currentSeq, true);
        restoreCapturedSelection();
        setState("idle", "Voice undo executed", { usedPaidKey });
        return;
      }

      const activeApp = await getActiveAppName();
      const audioDurationSec = Math.max(1, Math.round(data.byteLength / 4000));
      const isBurmeseText = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(text);
      const isEnglish = !isBurmeseText;
      const cost = calculateDictationCost(audioDurationSec, text.length, modelUsed || currentConfig.geminiModel, isEnglish);

      const pasteResult = await pasteCoordinator.pasteText(text);

      if (!isCurrentTranscription(currentSeq)) {
        logger.warn({ currentSeq }, "Discarding stale paste result");
        return;
      }

      if (pasteResult.status === "submitted") {
        recordingLifecycle.finishTranscription(currentSeq, true);
        restoreCapturedSelection();
        addHistoryEntry(text, activeApp, cost, audioDurationSec, modelUsed || currentConfig.geminiModel, usedPaidKey);
        lastPastedText = text;
        lastPasteTime = Date.now();
        playSuccessChime();
        setState("idle", `Dictated: "${text}"`, { usedPaidKey });
      } else {
        recordingLifecycle.finishTranscription(currentSeq, false);
        recordingLifecycle.settle();
        restoreCapturedSelection();
        addHistoryEntry(text, activeApp, cost, audioDurationSec, modelUsed || currentConfig.geminiModel, usedPaidKey);
        logger.warn({ pasteResult }, "Target window changed or paste denied - transcript saved to history");
        setState("idle", "Target changed - transcript saved to history", { usedPaidKey });
      }
    } catch (err: any) {
      if (!isCurrentTranscription(currentSeq)) return;
      recordingLifecycle.finishTranscription(currentSeq, false);
      restoreCapturedSelection();
      logger.error({ err: err.message }, "Transcription failed");
      setState("error", err.message);
      setTimeout(() => {
        if (currentState === "error") {
          recordingLifecycle.settle();
          setState("idle");
        }
      }, 6000);
    } finally {
      if (activeSTTAbortController === sttAbortController) {
        activeSTTAbortController = null;
      }
    }
  });

  ipcMain.on(IPC.CANCEL_DICTATION, (event) => {
    if (!validateIpcSender(event, true)) return;
    cancelDictation("Cancelled via user interface");
  });

  ipcMain.on(IPC.RECORDING_ERROR, (event, error: string) => {
    if (!validateIpcSender(event)) return;
    logger.warn({ error }, "Recording warning");
    pasteCoordinator.invalidate();
    recordingLifecycle.reset();
    restoreCapturedSelection();
    setState("error", error);
  });

  ipcMain.on(IPC.AUDIO_LEVEL_UPDATE, (event, level: number) => {
    if (!validateIpcSender(event)) return;
    popoverWindow?.webContents.send(IPC.AUDIO_LEVEL_UPDATE, level);
    hudWindow?.webContents.send(IPC.AUDIO_LEVEL_UPDATE, level);
  });

  ipcMain.handle(IPC.GET_CONFIG, (event) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    return currentConfig;
  });

  ipcMain.handle(IPC.SAVE_CONFIG, (event, patch) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    currentConfig = updateConfig(workingCwd, patch);
    if (patch.geminiApiKey !== undefined) {
      process.env.GEMINI_API_KEY = patch.geminiApiKey.trim();
      _resetGeminiClient();
    }
    if (patch.inputGain !== undefined) {
      captureWindow?.webContents.send(IPC.GAIN_UPDATE, currentConfig.inputGain);
    }
    return currentConfig;
  });

  ipcMain.handle(IPC.GET_HISTORY, (event) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    return getHistoryEntries();
  });

  ipcMain.handle(IPC.CLEAR_HISTORY, (event) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    clearHistory();
    return [];
  });

  ipcMain.handle(IPC.TOGGLE_DICTATION, (event) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    handleHotkeyDown();
    return { success: true };
  });

  ipcMain.handle(IPC.PREVIEW_CHIME, (event, soundName: string) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    playSound(soundName);
    return { success: true };
  });

  ipcMain.handle(IPC.TEST_API_KEY, async (event, keyToTest?: string) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    const targetKey = keyToTest || currentConfig.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!targetKey) {
      return { success: false, error: "No API Key provided" };
    }

    try {
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
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    if (!hotkeyService) return { success: false, error: "Hotkey service not initialized" };

    const res = await hotkeyService.replace(
      newKeyStr,
      {
        onDown: (mode) => handleHotkeyDown(mode),
        onUp: () => handleHotkeyUp(),
        onCancel: () => {
          if (currentState !== "idle") {
            cancelDictation("Cancelled via Escape key");
          }
        },
      },
      formatKeyBinding(currentConfig.editKey)
    );
    if (res.success && res.binding) {
      currentConfig = updateConfig(workingCwd, { key: newKeyStr });
    }
    return res;
  });

  ipcMain.handle(IPC.REGISTER_EDIT_HOTKEY, async (event, newKeyStr: string) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    if (!hotkeyService) return { success: false, error: "Hotkey service not initialized" };

    try {
      const binding = parseKeyBinding(newKeyStr);
      currentConfig = updateConfig(workingCwd, { editKey: newKeyStr });
      await hotkeyService.start(
        currentConfig.key,
        {
          onDown: (mode) => handleHotkeyDown(mode),
          onUp: () => handleHotkeyUp(),
          onCancel: () => {
            if (currentState !== "idle") {
              cancelDictation("Cancelled via Escape key");
            }
          },
        },
        currentConfig.editKey
      );
      return { success: true, binding, keyDisplay: currentConfig.editKeyDisplay };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

let lastHotkeyDownTime = 0;
let keyHoldPressStartTime = 0;
let lastHoldPressDuration = 0;
let currentTriggerMode: "dictate" | "edit" = "dictate";
let pendingStopOnStart = false;
let recordingStartTime = 0;

async function startRecordingFlow() {
  pendingStopOnStart = false;
  recordingStartTime = Date.now();
  const reqRes = recordingLifecycle.requestStart();
  if (!reqRes.accepted) {
    logger.warn({ reason: reqRes.reason }, "Cannot start recording flow");
    return;
  }

  pasteCoordinator.invalidate();
  safePasteService.captureTarget();
  setState("starting", "Starting...");
  playStartChime();

  // Start pre-roll audio capture immediately in starting state to prevent first-phoneme clipping
  captureWindow?.webContents.send(IPC.START_RECORDING, "webm", currentConfig.inputGain);

  const selectionAbortController = new AbortController();
  activeSelectionAbortController = selectionAbortController;
  let selection: Awaited<ReturnType<typeof captureActiveSelection>>;
  try {
    selection = await captureActiveSelection(350, { signal: selectionAbortController.signal, port: selectionClipboardPort ?? undefined });
  } catch (err: any) {
    if (activeSelectionAbortController === selectionAbortController) activeSelectionAbortController = null;
    const snapshot = recordingLifecycle.snapshot();
    if (snapshot.sequenceId !== reqRes.sequenceId || snapshot.state !== "starting") return;
    pasteCoordinator.invalidate();
    recordingLifecycle.acknowledgeStart(reqRes.sequenceId, false);
    captureWindow?.webContents.send(IPC.CANCEL_RECORDING);
    logger.error({ err: err?.message || String(err) }, "Selection capture failed");
    setState("error", "Selection capture failed");
    return;
  }
  if (activeSelectionAbortController === selectionAbortController) activeSelectionAbortController = null;
  const lifecycleSnapshot = recordingLifecycle.snapshot();
  if (lifecycleSnapshot.sequenceId !== reqRes.sequenceId || lifecycleSnapshot.state !== "starting") {
    captureWindow?.webContents.send(IPC.CANCEL_RECORDING);
    if (currentState === "idle" && selection.hasSelection) restoreClipboard(selection.previousClipboard, selectionClipboardPort);
    return;
  }

  previousClipboardContent = selection.previousClipboard;
  selectionCaptured = selection.hasSelection;

  if (currentTriggerMode === "edit" && selection.hasSelection) {
    activeSelectionText = selection.selectedText;
  } else {
    // Pure Dictation mode: clear activeSelectionText for STT prompt so Gemini does pure dictation (and overwrites selection)
    activeSelectionText = "";
  }

  logger.info({ triggerMode: currentTriggerMode, hasSelection: selection.hasSelection, selectionLength: activeSelectionText.length }, "STARTING recording flow");
  setState("recording", "Recording...");
  recordingLifecycle.acknowledgeStart(reqRes.sequenceId, true);

  if (pendingStopOnStart && currentConfig.dictationMode === "hold") {
    if (hotkeyService?.isFnDown()) {
      logger.info("Live key state isFnDown is true upon entering recording state; clearing pendingStopOnStart");
      pendingStopOnStart = false;
    } else {
      logger.info({ lastHoldPressDuration }, "Queued stop executing upon entering recording state with minimum capture window");
      const elapsed = Date.now() - recordingStartTime;
      const minDuration = getHoldModeMinimumDuration(lastHoldPressDuration, false);
      const delay = Math.max(0, minDuration - elapsed);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const snapshot = recordingLifecycle.snapshot();
      if (snapshot.sequenceId === reqRes.sequenceId && snapshot.state === "recording") {
        const stopRes = recordingLifecycle.requestStop();
        if (stopRes.accepted) {
          setState("stopping", "Stopping...");
          playToggleStopChime();
          captureWindow?.webContents.send(IPC.STOP_RECORDING, true);
        }
      }
    }
  }
}

function handleHotkeyDown(mode: "dictate" | "edit" = "dictate") {
  const now = Date.now();
  if (now - lastHotkeyDownTime < 350) {
    logger.warn({ deltaMs: now - lastHotkeyDownTime }, "Debounced duplicate hotkey down trigger");
    return;
  }
  lastHotkeyDownTime = now;
  keyHoldPressStartTime = now;
  currentTriggerMode = mode;

  prewarmConnection();

  if (currentState === "transcribing" || currentState === "stopping" || currentState === "starting") {
    logger.info({ state: currentState }, "Hotkey down during active processing - cancelling dictation");
    cancelDictation("Cancelled via hotkey");
    return;
  }

  if (currentConfig.dictationMode === "hold") {
    if (currentState === "idle" || currentState === "error") {
      startRecordingFlow();
    }
  } else {
    toggleRecordingState();
  }
}

function handleHotkeyUp() {
  if (currentConfig.dictationMode !== "hold") return;

  const pressDuration = Date.now() - keyHoldPressStartTime;
  lastHoldPressDuration = pressDuration;

  if (currentState === "starting") {
    logger.info({ pressDuration }, "Key Up during starting state: queuing stop");
    pendingStopOnStart = true;
  } else if (currentState === "recording") {
    const elapsed = recordingStartTime > 0 ? Date.now() - recordingStartTime : pressDuration;
    const liveFnDown = hotkeyService?.isFnDown() ?? false;
    const minDuration = getHoldModeMinimumDuration(pressDuration, liveFnDown);
    const remainingDelay = minDuration - elapsed;

    if (pressDuration < SHORT_TAP_THRESHOLD_MS && !liveFnDown && remainingDelay > 0) {
      logger.info({ pressDuration, elapsed, remainingDelay }, "Short tap (<250ms) in Hold Mode: extending recording duration");
      setTimeout(() => {
        const snapshot = recordingLifecycle.snapshot();
        if (snapshot.state === "recording") {
          const stopRes = recordingLifecycle.requestStop();
          if (stopRes.accepted) {
            setState("stopping", "Stopping...");
            playToggleStopChime();
            captureWindow?.webContents.send(IPC.STOP_RECORDING, true);
          }
        }
      }, remainingDelay);
      return;
    }

    const ensureMinimumDuration = shouldEnsureMinimumDuration(pressDuration, elapsed);
    logger.info({ pressDuration, elapsed, ensureMinimumDuration }, "Key Up: STOPPING recording (Hold Mode)");
    const stopRes = recordingLifecycle.requestStop();
    if (stopRes.accepted) {
      setState("stopping", "Stopping...");
      playToggleStopChime();
      captureWindow?.webContents.send(IPC.STOP_RECORDING, ensureMinimumDuration);
    }
  }
}

function toggleRecordingState() {
  if (currentState === "recording") {
    logger.info("Tap 2: STOPPING recording");
    const stopRes = recordingLifecycle.requestStop();
    if (stopRes.accepted) {
      setState("stopping", "Stopping...");
      playToggleStopChime();
      captureWindow?.webContents.send(IPC.STOP_RECORDING);
    }
  } else if (currentState === "transcribing" || currentState === "stopping" || currentState === "starting") {
    logger.info({ state: currentState }, "Hotkey re-triggered during active state - cancelling dictation");
    cancelDictation("Cancelled via hotkey");
  } else if (currentState === "idle" || currentState === "error") {
    startRecordingFlow();
  }
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
      setImmediate(() => app.quit());
      return { ok: true };
    default:
      return { ok: false, error: `Unknown command: ${command}` };
  }
}

function gracefulShutdown() {
  logger.info("Shutting down...");
  pasteCoordinator.invalidate();
  hotkeyService?.stop();
  stopDaemonServer();
  removeRuntimeState();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
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

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock && !process.argv.includes("--headless")) return;

  if (process.argv.includes("--headless")) {
    const isOk = addon !== null && typeof addon.selfCheck === "function" && addon.selfCheck() === true;
    if (isOk) {
      console.log("native paste addon self-check ok");
      process.exit(0);
    } else {
      console.error("native paste addon self-check failed");
      process.exit(1);
    }
  }

  app.name = "vo";
  app.setName("vo");

  if (app.dock) {
    app.dock.hide();
  }

  try {
    currentConfig = loadConfig(workingCwd);
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err) }, "Config error during startup, using defaultConfig");
    currentConfig = defaultConfig();
  }

  createCaptureWindow();
  createPopoverWindow();
  createHudWindow();
  createTray();

  setupIpcHandlers();

  hotkeyService = new HotkeyService();
  await hotkeyService.start(
    currentConfig.key,
    {
      onDown: (mode) => handleHotkeyDown(mode),
      onUp: () => handleHotkeyUp(),
      onCancel: () => {
        if (currentState !== "idle") {
          cancelDictation("Cancelled via Escape key");
        }
      },
    },
    currentConfig.editKey
  );

  prewarmGeminiClient();
  startDaemonServer(handleDaemonCommand);
  saveRuntimeState(workingCwd);

  logger.info({ cwd: workingCwd, provider: currentConfig.provider, geminiModel: currentConfig.geminiModel, dictationMode: currentConfig.dictationMode }, "vo daemon started successfully");
});

app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  if (gotSingleInstanceLock) gracefulShutdown();
});
