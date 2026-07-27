import { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, clipboard, type IpcMainInvokeEvent } from "electron";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, updateConfig, ConfigError, type PiVoiceConfig } from "./services/config.js";
import { transcribe, prewarmGeminiClient, getActiveAppName } from "./services/stt.js";
import { _resetGeminiClient } from "./services/gemini-client.js";
import { addHistoryEntry, getHistoryEntries, clearHistory, calculateDictationCost, getMonthlyTotalCost } from "./services/history-service.js";
import { IPC, type AppState, type StatePayload } from "./shared/types.js";
import { saveRuntimeState, removeRuntimeState } from "./services/runtime-state.js";
import { startDaemonServer, stopDaemonServer, type DaemonCommand, type DaemonResponse } from "./services/daemon-ipc.js";
import { HotkeyService } from "./services/hotkey-service.js";
import { calculatePopoverPosition } from "./services/popover-position.js";
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
const nativePasteBin = join(projectRoot, "bin", "pi-paste");

let captureWindow: BrowserWindow | null = null;
let popoverWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let hotkeyService: HotkeyService | null = null;
let currentConfig: PiVoiceConfig;

let currentState: AppState = "idle";
let sequenceId = 0;
let isPasting = false;
let lastPastedText = "";
let lastPasteTime = 0;

let stoppingSafetyTimer: ReturnType<typeof setTimeout> | null = null;

let hudWindow: BrowserWindow | null = null;
let hudHideTimer: ReturnType<typeof setTimeout> | null = null;

function setState(state: AppState, message?: string) {
  currentState = state;
  sequenceId++;
  const payload: StatePayload = { state, message, sequenceId };
  logger.info({ state, message, sequenceId }, "State changed");

  if (stoppingSafetyTimer) {
    clearTimeout(stoppingSafetyTimer);
    stoppingSafetyTimer = null;
  }

  if (state === "stopping") {
    stoppingSafetyTimer = setTimeout(() => {
      if (currentState === "stopping") {
        logger.warn("Stopping state timed out, auto-resetting state machine to idle");
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
    if (state === "recording" || state === "stopping" || state === "transcribing" || state === "starting") {
      hudWindow.showInactive();
    } else {
      hudHideTimer = setTimeout(() => {
        if (currentState === "idle" || currentState === "error") {
          hudWindow?.hide();
        }
      }, 1500);
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

function pasteTextToFocusedField(text: string) {
  const now = Date.now();
  if (isPasting || (text === lastPastedText && now - lastPasteTime < 1500)) {
    logger.warn({ text }, "Duplicate paste request blocked by mutex guard");
    return;
  }

  isPasting = true;
  lastPastedText = text;
  lastPasteTime = now;

  try {
    clipboard.writeText(text);

    const hasNativePaste = existsSync(nativePasteBin);
    const pasteCmd = hasNativePaste
      ? `"${nativePasteBin}"`
      : `osascript -e 'tell application "System Events" to key code 9 using command down'`;

    exec(pasteCmd, (err) => {
      isPasting = false;
      if (err) {
        logger.error({ err: String(err) }, "Paste command failed");
      } else {
        logger.info({ text, native: hasNativePaste }, "Pasted transcribed text into active input field");
        playSuccessChime();
      }
    });
  } catch (pasteErr) {
    isPasting = false;
    logger.error({ err: String(pasteErr) }, "Failed to paste text into active window");
  }
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

function executeUndoCommand(textLengthToUndo: number = 0) {
  try {
    const activeApp = getActiveAppName();
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
    width: 310,
    height: 380,
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

function createHudWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const screenBounds = primaryDisplay.workArea;
  const width = 240;
  const height = 44;
  const x = Math.round(screenBounds.x + (screenBounds.width - width) / 2);
  const y = screenBounds.y + 16;

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
    hasShadow: true,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  hudWindow.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));

  hudWindow.on("closed", () => {
    hudWindow = null;
  });
}

function togglePopover() {
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
      { width: 310, height: 380 },
      screenBounds
    );

    popoverWindow.setPosition(pos.x, pos.y);
    popoverWindow.showInactive();
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

function validateIpcSender(event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const senderId = event.sender.id;
  const isCapture = captureWindow && senderId === captureWindow.webContents.id;
  const isPopover = popoverWindow && senderId === popoverWindow.webContents.id;
  return Boolean(isCapture || isPopover);
}

function setupIpcHandlers() {
  ipcMain.on(IPC.RECORDING_DATA, async (event, data: ArrayBuffer) => {
    if (!validateIpcSender(event)) return;
    if (currentState !== "recording" && currentState !== "stopping") return;

    if (data.byteLength < 1000) {
      setState("idle", "Recording too short");
      return;
    }

    try {
      setState("transcribing", "Transcribing...");
      const text = await transcribe(data, {
        provider: currentConfig.provider,
        geminiModel: currentConfig.geminiModel,
        dictationPreset: currentConfig.dictationPreset,
        customVocabulary: currentConfig.customVocabulary,
        presetVocabulary: currentConfig.presetVocabulary,
        symbolScannerEnabled: currentConfig.symbolScannerEnabled,
      });

      if (!text || text.trim().length === 0) {
        setState("idle", "No speech detected");
        return;
      }

      logger.info({ text }, "STT transcription successful");

      const isUndo = handleVoiceUndoCheck(text);
      if (!isUndo) {
        pasteTextToFocusedField(text);
        const activeApp = getActiveAppName();
        const audioDurationSec = Math.max(1, Math.round(data.byteLength / 4000));
        const isEnglish = currentConfig.dictationPreset !== "burmese_written" && currentConfig.dictationPreset !== "fast";
        const cost = calculateDictationCost(audioDurationSec, text.length, currentConfig.geminiModel, isEnglish);
        addHistoryEntry(text, activeApp, cost, audioDurationSec, currentConfig.geminiModel);
      }
      setState("idle", `Dictated: "${text}"`);
    } catch (err: any) {
      logger.error({ err: err.message }, "Transcription failed");
      setState("error", err.message);
      setTimeout(() => {
        if (currentState === "error") setState("idle");
      }, 1500);
    }
  });

  ipcMain.on(IPC.RECORDING_ERROR, (event, error: string) => {
    if (!validateIpcSender(event)) return;
    logger.warn({ error }, "Recording warning");
    setState("error", error);
  });

  ipcMain.on(IPC.AUDIO_LEVEL_UPDATE, (event, level: number) => {
    if (!validateIpcSender(event)) return;
    popoverWindow?.webContents.send(IPC.AUDIO_LEVEL_UPDATE, level);
  });

  ipcMain.handle(IPC.GET_CONFIG, (event) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    return currentConfig;
  });

  ipcMain.handle(IPC.SAVE_CONFIG, (event, patch) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    currentConfig = updateConfig(workingCwd, patch);
    if (patch.geminiApiKey !== undefined) {
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
      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({ apiKey: targetKey });
      const res = await client.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: "Ping",
      });
      if (res && res.text !== undefined) {
        return { success: true, message: "API Key is valid & active!" };
      }
      return { success: false, error: "Empty response from Gemini API" };
    } catch (err: any) {
      return { success: false, error: err.message || "Invalid API Key" };
    }
  });

  ipcMain.handle(IPC.REGISTER_HOTKEY, async (event, newKeyStr: string) => {
    if (!validateIpcSender(event)) throw new Error("Unauthorized sender");
    if (!hotkeyService) return { success: false, error: "Hotkey service not initialized" };

    const res = await hotkeyService.replace(newKeyStr, {
      onDown: () => handleHotkeyDown(),
      onUp: () => handleHotkeyUp(),
    });
    if (res.success && res.binding) {
      currentConfig = updateConfig(workingCwd, { key: newKeyStr });
    }
    return res;
  });
}

let lastHotkeyDownTime = 0;
let keyHoldPressStartTime = 0;

function handleHotkeyDown() {
  const now = Date.now();
  if (now - lastHotkeyDownTime < 350) {
    logger.warn({ deltaMs: now - lastHotkeyDownTime }, "Debounced duplicate hotkey down trigger");
    return;
  }
  lastHotkeyDownTime = now;
  keyHoldPressStartTime = now;

  if (currentConfig.dictationMode === "hold") {
    if (currentState === "idle" || currentState === "error") {
      logger.info("Hold Down: STARTING recording");
      setState("recording", "Recording...");
      playStartChime();
      captureWindow?.webContents.send(IPC.START_RECORDING, "webm", currentConfig.inputGain);
    }
  } else {
    toggleRecordingState();
  }
}

function handleHotkeyUp() {
  const pressDuration = Date.now() - keyHoldPressStartTime;
  if (currentConfig.dictationMode === "hold" || (currentConfig.dictationMode === "toggle" && pressDuration > 350)) {
    if (currentState === "recording" || currentState === "starting") {
      logger.info({ pressDuration }, "Key Up: STOPPING recording (Hold Auto-Detect)");
      setState("stopping", "Stopping...");
      playToggleStopChime();
      captureWindow?.webContents.send(IPC.STOP_RECORDING);
    }
  }
}

function toggleRecordingState() {
  if (currentState === "recording") {
    logger.info("Tap 2: STOPPING recording");
    setState("stopping", "Stopping...");
    playToggleStopChime();
    captureWindow?.webContents.send(IPC.STOP_RECORDING);
  } else if (currentState === "idle" || currentState === "error") {
    logger.info("Tap 1: STARTING recording");
    setState("recording", "Recording...");
    playStartChime();
    captureWindow?.webContents.send(IPC.START_RECORDING, "webm", currentConfig.inputGain);
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
    case "stop":
      setImmediate(() => app.quit());
      return { ok: true };
    default:
      return { ok: false, error: `Unknown command: ${command}` };
  }
}

function gracefulShutdown() {
  logger.info("Shutting down...");
  hotkeyService?.stop();
  stopDaemonServer();
  removeRuntimeState();
}

app.whenReady().then(async () => {
  app.name = "vo";
  app.setName("vo");

  if (app.dock) {
    app.dock.hide();
  }

  try {
    currentConfig = loadConfig(workingCwd);
  } catch (err: any) {
    logger.error({ err: err.message }, "Config error");
    app.quit();
    return;
  }

  createCaptureWindow();
  createPopoverWindow();
  createHudWindow();
  createTray();

  setupIpcHandlers();

  hotkeyService = new HotkeyService();
  await hotkeyService.start(currentConfig.key, {
    onDown: () => handleHotkeyDown(),
    onUp: () => handleHotkeyUp(),
  });

  prewarmGeminiClient();
  startDaemonServer(handleDaemonCommand);
  saveRuntimeState(workingCwd);

  logger.info({ cwd: workingCwd, provider: currentConfig.provider, geminiModel: currentConfig.geminiModel, dictationMode: currentConfig.dictationMode }, "vo daemon started successfully");
});

app.on("window-all-closed", () => {});
app.on("before-quit", () => gracefulShutdown());
