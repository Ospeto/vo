import type { BrowserWindow, IpcMainInvokeEvent, IpcMainEvent } from "electron";
import { IPC, type RendererRole, type CaptureConfigPayload, type SettingsConfigPayload } from "../shared/types.js";
import type { PiVoiceConfig } from "./config.js";
import logger from "./logger.js";

export const CHANNEL_ROLE_ALLOWLIST: Record<string, RendererRole[]> = {
  [IPC.RECORDING_DATA]: ["capture"],
  [IPC.RECORDING_ERROR]: ["capture"],
  [IPC.RECORDING_START_READY]: ["capture"],
  [IPC.RECORDING_START_FAILED]: ["capture"],
  [IPC.RECORDING_STOPPED]: ["capture"],
  [IPC.AUDIO_LEVEL_UPDATE]: ["capture"],
  [IPC.CANCEL_DICTATION]: ["settings", "hud"],
  [IPC.GET_CONFIG]: ["settings", "capture"],
  [IPC.SAVE_CONFIG]: ["settings"],
  [IPC.GET_HISTORY]: ["settings"],
  [IPC.CLEAR_HISTORY]: ["settings"],
  [IPC.TOGGLE_DICTATION]: ["settings"],
  [IPC.TEST_API_KEY]: ["settings"],
  [IPC.PREVIEW_CHIME]: ["settings"],
  [IPC.REGISTER_HOTKEY]: ["settings"],
  [IPC.REGISTER_EDIT_HOTKEY]: ["settings"],
  [IPC.STATE_SNAPSHOT]: ["settings"],
};

export function getSenderRole(
  senderWebContents: Electron.WebContents | null,
  activePopover?: BrowserWindow | null,
  activeCapture?: BrowserWindow | null,
  activeHud?: BrowserWindow | null
): { role: RendererRole; window: BrowserWindow } | null {
  if (!senderWebContents) return null;

  if (activePopover && !activePopover.isDestroyed() && senderWebContents === activePopover.webContents) {
    return { role: "settings", window: activePopover };
  }
  if (activeCapture && !activeCapture.isDestroyed() && senderWebContents === activeCapture.webContents) {
    return { role: "capture", window: activeCapture };
  }
  if (activeHud && !activeHud.isDestroyed() && senderWebContents === activeHud.webContents) {
    return { role: "hud", window: activeHud };
  }
  return null;
}

export function validateIpcSenderPolicy(
  event: IpcMainInvokeEvent | IpcMainEvent,
  channel: string,
  activePopover?: BrowserWindow | null,
  activeCapture?: BrowserWindow | null,
  activeHud?: BrowserWindow | null
): { role: RendererRole; window: BrowserWindow } {
  const matched = getSenderRole(event.sender, activePopover, activeCapture, activeHud);
  if (!matched) {
    throw new Error(`Unauthorized IPC sender: window not recognized for channel '${channel}'`);
  }

  // Subframe denial
  const frame = (event as any).frame || (event as any).senderFrame;
  if (frame) {
    if (frame.parent !== null || (event.sender.mainFrame && frame !== event.sender.mainFrame)) {
      throw new Error(`Unauthorized IPC sender: subframes are not permitted for channel '${channel}'`);
    }
  }

  // URL & Path validation
  const frameUrlStr = frame?.url || event.sender.getURL();
  if (!frameUrlStr) {
    throw new Error(`Unauthorized IPC sender: missing frame URL for channel '${channel}'`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(frameUrlStr);
  } catch {
    throw new Error(`Unauthorized IPC sender: invalid frame URL '${frameUrlStr}' for channel '${channel}'`);
  }

  if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
    throw new Error(`Unauthorized IPC sender: remote origin '${parsedUrl.origin}' is denied for channel '${channel}'`);
  }

  const pathname = parsedUrl.pathname;
  const expectedPage = matched.role === "settings" ? "index.html" : matched.role === "capture" ? "capture.html" : "hud.html";

  if (!pathname.endsWith(`/${expectedPage}`) && !pathname.endsWith(`\\${expectedPage}`)) {
    throw new Error(`Unauthorized IPC sender: path '${pathname}' does not match expected page '${expectedPage}' for role '${matched.role}'`);
  }

  // Channel allowlist validation
  const allowedRoles = CHANNEL_ROLE_ALLOWLIST[channel];
  if (!allowedRoles || !allowedRoles.includes(matched.role)) {
    throw new Error(`Unauthorized IPC sender: role '${matched.role}' is not allowed for channel '${channel}'`);
  }

  return matched;
}

export function getSanitizedSettingsConfig(config: PiVoiceConfig): SettingsConfigPayload {
  const {
    geminiApiKey,
    geminiFallbackApiKey,
    geminiKeyError,
    geminiFallbackKeyError,
    legacyProjectKeyBlocked,
    legacyProjectKeyRemediation,
    ...rest
  } = config;
  return {
    ...rest,
    hasGeminiKey: Boolean(geminiApiKey && geminiApiKey.trim().length > 0),
    hasGeminiFallbackKey: Boolean(geminiFallbackApiKey && geminiFallbackApiKey.trim().length > 0),
    ...(geminiKeyError ? { geminiKeyError } : {}),
    ...(geminiFallbackKeyError ? { geminiFallbackKeyError } : {}),
    ...(legacyProjectKeyBlocked ? { legacyProjectKeyBlocked: true } : {}),
    ...(legacyProjectKeyRemediation ? { legacyProjectKeyRemediation } : {}),
    hasOpenAIKey: false,
  };
}

export function getCaptureConfigPayload(config: PiVoiceConfig): CaptureConfigPayload {
  return {
    audioDeviceId: config.audioDeviceId,
    autoEndpointEnabled: config.autoEndpointEnabled,
    transcriptionDelaySec: config.transcriptionDelaySec,
    inputGain: config.inputGain,
    dictationMode: config.dictationMode,
  };
}

export function applyWindowSecurityGuards(win: BrowserWindow) {
  const contents = win.webContents;

  contents.on("will-navigate", (event, navigationUrl) => {
    event.preventDefault();
    logger.warn({ navigationUrl }, "Blocked unexpected window navigation");
  });

  contents.setWindowOpenHandler(({ url }) => {
    logger.warn({ url }, "Blocked unexpected window creation");
    return { action: "deny" };
  });

  if (typeof (contents as any).on === "function") {
    (contents as any).on("will-attach-webview", (event: any) => {
      event.preventDefault();
      logger.warn("Blocked unexpected webview attachment");
    });
  }
}
