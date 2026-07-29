import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHANNEL_ROLE_ALLOWLIST,
  validateIpcSenderPolicy,
  getSanitizedSettingsConfig,
  getCaptureConfigPayload,
  applyWindowSecurityGuards,
} from "../../services/ipc-policy.js";
import { IPC, type RendererRole } from "../../shared/types.js";
import type { PiVoiceConfig } from "../../services/config.js";

const ALL_ROLES: RendererRole[] = ["settings", "capture", "hud"];

const ALL_CHANNELS = [
  IPC.RECORDING_DATA,
  IPC.RECORDING_ERROR,
  IPC.AUDIO_LEVEL_UPDATE,
  IPC.CANCEL_DICTATION,
  IPC.GET_CONFIG,
  IPC.SAVE_CONFIG,
  IPC.GET_HISTORY,
  IPC.CLEAR_HISTORY,
  IPC.TOGGLE_DICTATION,
  IPC.TEST_API_KEY,
  IPC.PREVIEW_CHIME,
  IPC.REGISTER_HOTKEY,
  IPC.REGISTER_EDIT_HOTKEY,
];

function createMockWindow(role: RendererRole, urlPath?: string, isDestroyed = false) {
  const page = urlPath || (role === "settings" ? "index.html" : role === "capture" ? "capture.html" : "hud.html");
  const url = `file:///app/out/renderer/${page}`;
  
  const webContents = {
    id: Math.floor(Math.random() * 10000) + 1,
    getURL: () => url,
    mainFrame: { url, parent: null },
    listeners: new Map<string, Function[]>(),
    windowOpenHandler: null as Function | null,
    on(event: string, fn: Function) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event)!.push(fn);
    },
    setWindowOpenHandler(fn: Function) {
      this.windowOpenHandler = fn;
    },
  };

  return {
    webContents,
    isDestroyed: () => isDestroyed,
  } as any;
}

function createMockEvent(win: any, frameUrl?: string, parentFrame: any = null) {
  const url = frameUrl || win.webContents.getURL();
  const mainFrame = win.webContents.mainFrame;
  const frame = parentFrame ? { url, parent: parentFrame } : { url, parent: null };
  
  return {
    sender: win.webContents,
    frame: parentFrame ? frame : mainFrame,
  } as any;
}

describe("PR-02 IPC Role Allowlist & Security Policy Suite", () => {
  describe("1. Role × Channel Authorization Matrix", () => {
    test("enumerates every renderer role × IPC channel, passing intended pairs and failing all others", () => {
      const popoverWin = createMockWindow("settings");
      const captureWin = createMockWindow("capture");
      const hudWin = createMockWindow("hud");

      ALL_ROLES.forEach((role) => {
        const winMap = {
          settings: popoverWin,
          capture: captureWin,
          hud: hudWin,
        };
        const currentWin = winMap[role];

        ALL_CHANNELS.forEach((channel) => {
          const event = createMockEvent(currentWin);
          const allowedRoles = CHANNEL_ROLE_ALLOWLIST[channel] || [];
          const isAllowed = allowedRoles.includes(role);

          if (isAllowed) {
            expect(() => {
              validateIpcSenderPolicy(event, channel, popoverWin, captureWin, hudWin);
            }).not.toThrow();
          } else {
            expect(() => {
              validateIpcSenderPolicy(event, channel, popoverWin, captureWin, hudWin);
            }).toThrow(/Unauthorized IPC sender/);
          }
        });
      });
    });
  });

  describe("2. Subframes, Destroyed Windows, and Path Validation", () => {
    test("rejects calls from subframes (non-main frame senders)", () => {
      const popoverWin = createMockWindow("settings");
      const subframeEvent = createMockEvent(popoverWin, "file:///app/out/renderer/index.html", { parent: {} });

      expect(() => {
        validateIpcSenderPolicy(subframeEvent, IPC.GET_CONFIG, popoverWin, null, null);
      }).toThrow(/subframes are not permitted/);
    });

    test("rejects calls from stale or destroyed windows", () => {
      const destroyedWin = createMockWindow("settings", undefined, true);
      const event = createMockEvent(destroyedWin);

      expect(() => {
        validateIpcSenderPolicy(event, IPC.GET_CONFIG, destroyedWin, null, null);
      }).toThrow(/window not recognized/);
    });

    test("rejects calls when window path does not match expected page for role", () => {
      // Popover window loaded with capture.html instead of index.html
      const wrongPathWin = createMockWindow("settings", "capture.html");
      const event = createMockEvent(wrongPathWin);

      expect(() => {
        validateIpcSenderPolicy(event, IPC.SAVE_CONFIG, wrongPathWin, null, null);
      }).toThrow(/does not match expected page/);
    });

    test("rejects calls originating from remote http/https URLs", () => {
      const remoteWin = createMockWindow("settings", "index.html");
      remoteWin.webContents.getURL = () => "https://evil.com/phishing.html";
      remoteWin.webContents.mainFrame = { url: "https://evil.com/phishing.html", parent: null };
      const remoteEvent = createMockEvent(remoteWin);

      expect(() => {
        validateIpcSenderPolicy(remoteEvent, IPC.GET_CONFIG, remoteWin, null, null);
      }).toThrow(/remote origin 'https:\/\/evil.com' is denied/);
    });
  });

  describe("3. Window Navigation, Popups, and Webview Hardening", () => {
    test("denies unexpected window creation via setWindowOpenHandler", () => {
      const mockWin = createMockWindow("settings");
      applyWindowSecurityGuards(mockWin);

      expect(mockWin.webContents.windowOpenHandler).not.toBeNull();
      const res = mockWin.webContents.windowOpenHandler({ url: "https://example.com" });
      expect(res).toEqual({ action: "deny" });
    });

    test("denies unexpected navigation and webview attachment", () => {
      const mockWin = createMockWindow("settings");
      applyWindowSecurityGuards(mockWin);

      const navListeners = mockWin.webContents.listeners.get("will-navigate") || [];
      expect(navListeners.length).toBeGreaterThan(0);
      let navPrevented = false;
      navListeners[0]({ preventDefault: () => { navPrevented = true; } }, "https://example.com");
      expect(navPrevented).toBe(true);

      const webviewListeners = mockWin.webContents.listeners.get("will-attach-webview") || [];
      expect(webviewListeners.length).toBeGreaterThan(0);
      let webviewPrevented = false;
      webviewListeners[0]({ preventDefault: () => { webviewPrevented = true; } });
      expect(webviewPrevented).toBe(true);
    });
  });

  describe("4. Non-Secret Payload & Secret Stripping Policy", () => {
    const mockConfig: PiVoiceConfig = {
      key: { keycode: 47, ctrl: true, alt: true, shift: false, meta: true },
      keyDisplay: "⌃⌥⌘V",
      editKey: { keycode: 18, ctrl: false, alt: true, shift: false, meta: false },
      editKeyDisplay: "⌥E",
      provider: "gemini",
      geminiModel: "gemini-3.6-flash",
      inputGain: 1.2,
      dictationPreset: "careful",
      dictationMode: "toggle",
      translateEnabled: false,
      targetLanguage: "Japanese",
      audioChimesEnabled: true,
      chimeSoundStart: "pop",
      chimeSoundEnd: "tink",
      symbolScannerEnabled: true,
      transcriptionDelaySec: 0.5,
      autoEndpointEnabled: true,
      customVocabulary: ["term1"],
      presetVocabulary: {},
      dictionaryEntries: [],
      geminiApiKey: "AIzaSySecretKey123456",
      geminiFallbackApiKey: "AIzaSySecretFallbackKey789",
      audioDeviceId: "mic-123",
    };

    test("getSanitizedSettingsConfig strips decrypted secret keys and provides hasKey boolean flags", () => {
      const settingsPayload = getSanitizedSettingsConfig(mockConfig);

      expect((settingsPayload as any).geminiApiKey).toBeUndefined();
      expect((settingsPayload as any).geminiFallbackApiKey).toBeUndefined();
      expect(settingsPayload.hasGeminiKey).toBe(true);
      expect(settingsPayload.hasGeminiFallbackKey).toBe(true);
    });

    test("getCaptureConfigPayload returns only audio/recording fields without secret or settings fields", () => {
      const capturePayload = getCaptureConfigPayload(mockConfig);

      expect(capturePayload.audioDeviceId).toBe("mic-123");
      expect(capturePayload.autoEndpointEnabled).toBe(true);
      expect(capturePayload.transcriptionDelaySec).toBe(0.5);
      expect(capturePayload.inputGain).toBe(1.2);

      expect((capturePayload as any).geminiApiKey).toBeUndefined();
      expect((capturePayload as any).geminiFallbackApiKey).toBeUndefined();
      expect((capturePayload as any).dictionaryEntries).toBeUndefined();
      expect((capturePayload as any).customVocabulary).toBeUndefined();
    });

    test("asserts built preloads do not expose secret-fetching or unauthorized IPC calls to capture or HUD", () => {
      const capturePreloadPath = resolve(process.cwd(), "out/preload/capture.cjs");
      const hudPreloadPath = resolve(process.cwd(), "out/preload/hud.cjs");

      if (existsSync(capturePreloadPath)) {
        const captureCode = readFileSync(capturePreloadPath, "utf-8");
        expect(captureCode).not.toContain("save-config");
        expect(captureCode).not.toContain("get-history");
        expect(captureCode).not.toContain("test-api-key");
      }

      if (existsSync(hudPreloadPath)) {
        const hudContent = readFileSync(hudPreloadPath, "utf-8");
        expect(hudContent).not.toContain("get-config");
        expect(hudContent).not.toContain("save-config");
        expect(hudContent).not.toContain("get-history");
        expect(hudContent).not.toContain("test-api-key");
      }
    });
  });
});
