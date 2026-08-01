import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import EventEmitter from "node:events";

let mockIpcEmitter: EventEmitter;
let originalIpcRenderer: any;

beforeEach(() => {
  mockIpcEmitter = new EventEmitter();
  (mockIpcEmitter as any).removeListener = mockIpcEmitter.removeListener || mockIpcEmitter.off;
  originalIpcRenderer = (globalThis as any).ipcRenderer;
  (globalThis as any).ipcRenderer = {
    on: (channel: string, listener: any) => mockIpcEmitter.on(channel, listener),
    removeListener: (channel: string, listener: any) => mockIpcEmitter.removeListener(channel, listener),
    send: (channel: string, ...args: any[]) => mockIpcEmitter.emit(channel, {}, ...args),
    invoke: async (channel: string, ...args: any[]) => mockIpcEmitter.emit(channel, {}, ...args),
  };
});

afterEach(() => {
  (globalThis as any).ipcRenderer = originalIpcRenderer;
});

mock.module("electron", () => ({
  ipcRenderer: {
    on: (channel: string, listener: any) => mockIpcEmitter.on(channel, listener),
    removeListener: (channel: string, listener: any) => mockIpcEmitter.removeListener(channel, listener),
    send: (channel: string, ...args: any[]) => mockIpcEmitter.emit(channel, {}, ...args),
    invoke: async (channel: string, ...args: any[]) => mockIpcEmitter.emit(channel, {}, ...args),
  },
  contextBridge: {
    exposeInMainWorld: () => {},
  },
}));

import { subscribe } from "../../preload/shared.js";
import { cleanupCaptureSubscriptions, registerCaptureListeners } from "../../renderer/capture.js";

import type {
  SettingsElectronAPI,
  CaptureElectronAPI,
  HudElectronAPI,
  StatePayload,
  AudioLevelPayload,
  RecordingFormat,
  CaptureConfigPayload,
  SettingsConfigPayload,
} from "../../shared/types.js";

describe("PR-16 Bridge Contract & Subscription Lifecycle Suite", () => {
  describe("Compile-time contract assertions", () => {
    test("on* subscriptions in role-scoped APIs return exact unsubscribe closure () => void", () => {
      type SettingsOnStateRet = ReturnType<SettingsElectronAPI["onStateChanged"]>;
      type SettingsOnAudioRet = ReturnType<SettingsElectronAPI["onAudioLevelUpdate"]>;
      type CaptureOnStartRet = ReturnType<CaptureElectronAPI["onStartRecording"]>;
      type CaptureOnStopRet = ReturnType<CaptureElectronAPI["onStopRecording"]>;
      type CaptureOnCancelRet = ReturnType<CaptureElectronAPI["onCancelRecording"]>;
      type CaptureOnGainRet = ReturnType<CaptureElectronAPI["onGainUpdate"]>;
      type HudOnStateRet = ReturnType<HudElectronAPI["onStateChanged"]>;
      type HudOnAudioRet = ReturnType<HudElectronAPI["onAudioLevelUpdate"]>;

      const check1: SettingsOnStateRet = () => {};
      const check2: SettingsOnAudioRet = () => {};
      const check3: CaptureOnStartRet = () => {};
      const check4: CaptureOnStopRet = () => {};
      const check5: CaptureOnCancelRet = () => {};
      const check6: CaptureOnGainRet = () => {};
      const check7: HudOnStateRet = () => {};
      const check8: HudOnAudioRet = () => {};

      expect(typeof check1).toBe("function");
      expect(typeof check2).toBe("function");
      expect(typeof check3).toBe("function");
      expect(typeof check4).toBe("function");
      expect(typeof check5).toBe("function");
      expect(typeof check6).toBe("function");
      expect(typeof check7).toBe("function");
      expect(typeof check8).toBe("function");
    });

    test("role-scoped bridge interfaces cover expected typed payloads without any", () => {
      const mockSettingsApi: SettingsElectronAPI = {
        getConfig: async () => ({} as SettingsConfigPayload),
        saveConfig: async (_patch) => ({} as SettingsConfigPayload),
        registerHotkey: async (_key) => ({ success: true }),
        registerEditHotkey: async (_key) => ({ success: true }),
        getHistory: async () => [],
        clearHistory: async () => [],
        toggleDictation: async () => ({ success: true }),
        testApiKey: async () => ({ success: true }),
        previewChime: async () => ({ success: true }),
        cancelDictation: () => {},
        onStateChanged: (_cb) => () => {},
        onAudioLevelUpdate: (_cb) => () => {},
        getStateSnapshot: async () => ({ state: "idle" }),
      };

      const mockCaptureApi: CaptureElectronAPI = {
        getConfig: async () => ({} as CaptureConfigPayload),
        sendRecordingData: (_data) => {},
        sendRecordingError: (_error, _seq) => {},
        sendAudioLevelUpdate: (_payload) => {},
        onStartRecording: (_cb) => () => {},
        onStopRecording: (_cb) => () => {},
        onCancelRecording: (_cb) => () => {},
        onGainUpdate: (_cb) => () => {},
      };

      const mockHudApi: HudElectronAPI = {
        cancelDictation: () => {},
        onStateChanged: (_cb) => () => {},
        onAudioLevelUpdate: (_cb) => () => {},
      };

      expect(mockSettingsApi.getConfig).toBeDefined();
      expect(mockCaptureApi.sendRecordingData).toBeDefined();
      expect(mockHudApi.cancelDictation).toBeDefined();
    });
  });

  describe("Runtime emitter test & repeated reload listener isolation across all roles", () => {
    test("actual preload subscribe helper attaches listener and returns working unsubscribe closure", async () => {
      let invocations = 0;
      const channel = "state-changed-test";
      const handler = (payload: StatePayload) => {
        invocations++;
      };

      // Call actual subscribe helper
      const unsub = subscribe<StatePayload>(channel, handler);

      expect(invocations).toBe(0);
      mockIpcEmitter.emit(channel, {}, { state: "recording" });
      expect(invocations).toBe(1);

      // Verification: calling unsub removes listener from ipcRenderer
      unsub();
      mockIpcEmitter.emit(channel, {}, { state: "idle" });
      expect(invocations).toBe(1);
    });

    test("recreating capture, HUD, and settings subscriptions 10 times results in 1 action per event and zero listener growth", () => {
      const captureEmitter = new EventEmitter();
      const hudEmitter = new EventEmitter();
      const settingsEmitter = new EventEmitter();

      let captureActionCount = 0;
      let hudActionCount = 0;
      let settingsActionCount = 0;

      // Mock Capture bridge
      const createCaptureBridge = (): { bridge: CaptureElectronAPI; unsubscribes: Array<() => void> } => {
        const unsubs: Array<() => void> = [];
        const bridge: CaptureElectronAPI = {
          getConfig: async () => ({ inputGain: 1.0 }),
          sendRecordingData: () => {},
          sendRecordingError: () => {},
          sendAudioLevelUpdate: () => {},
          onStartRecording: (cb) => {
            const h = (_evt: any, fmt: RecordingFormat, gain: number, seq: number) => cb(fmt, gain, seq);
            captureEmitter.on("start-recording", h);
            const unsub = () => captureEmitter.removeListener("start-recording", h);
            unsubs.push(unsub);
            return unsub;
          },
          onStopRecording: (cb) => {
            const h = (_evt: any, min?: boolean) => cb(min);
            captureEmitter.on("stop-recording", h);
            const unsub = () => captureEmitter.removeListener("stop-recording", h);
            unsubs.push(unsub);
            return unsub;
          },
          onCancelRecording: (cb) => {
            const h = () => cb();
            captureEmitter.on("cancel-recording", h);
            const unsub = () => captureEmitter.removeListener("cancel-recording", h);
            unsubs.push(unsub);
            return unsub;
          },
          onGainUpdate: (cb) => {
            const h = (_evt: any, gain: number) => cb(gain);
            captureEmitter.on("gain-update", h);
            const unsub = () => captureEmitter.removeListener("gain-update", h);
            unsubs.push(unsub);
            return unsub;
          },
        };
        return { bridge, unsubscribes: unsubs };
      };

      // Mock HUD bridge
      const createHudBridge = (): { bridge: HudElectronAPI; unsubscribes: Array<() => void> } => {
        const unsubs: Array<() => void> = [];
        const bridge: HudElectronAPI = {
          cancelDictation: () => {},
          onStateChanged: (cb) => {
            const h = (_evt: any, payload: StatePayload) => cb(payload);
            hudEmitter.on("state-changed", h);
            const unsub = () => hudEmitter.removeListener("state-changed", h);
            unsubs.push(unsub);
            return unsub;
          },
          onAudioLevelUpdate: (cb) => {
            const h = (_evt: any, payload: AudioLevelPayload) => cb(payload);
            hudEmitter.on("audio-level-update", h);
            const unsub = () => hudEmitter.removeListener("audio-level-update", h);
            unsubs.push(unsub);
            return unsub;
          },
        };
        return { bridge, unsubscribes: unsubs };
      };

      // Mock Settings bridge
      const createSettingsBridge = (): { bridge: SettingsElectronAPI; unsubscribes: Array<() => void> } => {
        const unsubs: Array<() => void> = [];
        const bridge: SettingsElectronAPI = {
          getConfig: async () => ({} as SettingsConfigPayload),
          saveConfig: async (_p) => ({} as SettingsConfigPayload),
          registerHotkey: async () => ({ success: true }),
          registerEditHotkey: async () => ({ success: true }),
          getHistory: async () => [],
          clearHistory: async () => [],
          toggleDictation: async () => ({ success: true }),
          testApiKey: async () => ({ success: true }),
          previewChime: async () => ({ success: true }),
          cancelDictation: () => {},
          getStateSnapshot: async () => ({ state: "idle" }),
          onStateChanged: (cb) => {
            const h = (_evt: any, payload: StatePayload) => cb(payload);
            settingsEmitter.on("state-changed", h);
            const unsub = () => settingsEmitter.removeListener("state-changed", h);
            unsubs.push(unsub);
            return unsub;
          },
          onAudioLevelUpdate: (cb) => {
            const h = (_evt: any, payload: AudioLevelPayload) => cb(payload);
            settingsEmitter.on("audio-level-update", h);
            const unsub = () => settingsEmitter.removeListener("audio-level-update", h);
            unsubs.push(unsub);
            return unsub;
          },
        };
        return { bridge, unsubscribes: unsubs };
      };

      // Perform 10 iterations of recreating subscriptions & reloading renderers
      for (let iteration = 0; iteration < 10; iteration++) {
        const capture = createCaptureBridge();
        const hud = createHudBridge();
        const settings = createSettingsBridge();

        // Attach listeners
        const unbindCapGain = capture.bridge.onGainUpdate(() => { captureActionCount++; });
        const unbindHudState = hud.bridge.onStateChanged(() => { hudActionCount++; });
        const unbindSettingsAudio = settings.bridge.onAudioLevelUpdate(() => { settingsActionCount++; });

        // Assert 1 listener per channel during active load
        expect(captureEmitter.listenerCount("gain-update")).toBe(1);
        expect(hudEmitter.listenerCount("state-changed")).toBe(1);
        expect(settingsEmitter.listenerCount("audio-level-update")).toBe(1);

        // Fire 1 event per channel -> exactly 1 action per iteration
        captureEmitter.emit("gain-update", {}, 1.5);
        hudEmitter.emit("state-changed", {}, { state: "recording" });
        settingsEmitter.emit("audio-level-update", {}, { level: 0.5 });

        expect(captureActionCount).toBe(iteration + 1);
        expect(hudActionCount).toBe(iteration + 1);
        expect(settingsActionCount).toBe(iteration + 1);

        // Simulate renderer unload cleanup
        unbindCapGain();
        unbindHudState();
        unbindSettingsAudio();

        // Assert 0 listeners remaining after unload
        expect(captureEmitter.listenerCount("gain-update")).toBe(0);
        expect(hudEmitter.listenerCount("state-changed")).toBe(0);
        expect(settingsEmitter.listenerCount("audio-level-update")).toBe(0);
      }

      // Final verification: 10 events fired, 10 actions total, 0 listener growth or leaks
      expect(captureActionCount).toBe(10);
      expect(hudActionCount).toBe(10);
      expect(settingsActionCount).toBe(10);
    });

    test("registerCaptureListeners with window override cleans up previous DOM & IPC subscriptions without leaks", async () => {
      const { cleanupCaptureSubscriptions, registerCaptureListeners } = await import("../../renderer/capture.js");
      const ipcEmitter = new EventEmitter();
      const mockWin: any = {
        piVoice: {
          getConfig: async () => ({ inputGain: 1.0 }),
          onGainUpdate: (cb: any) => {
            const h = (_evt: any, gain: number) => cb(gain);
            ipcEmitter.on("gain-update", h);
            return () => ipcEmitter.removeListener("gain-update", h);
          },
        },
      };

      // Call registerCaptureListeners 10 times in sequence
      for (let i = 0; i < 10; i++) {
        registerCaptureListeners(mockWin);
        expect(ipcEmitter.listenerCount("gain-update")).toBe(1);
      }

      // Cleanup
      cleanupCaptureSubscriptions();
      expect(ipcEmitter.listenerCount("gain-update")).toBe(0);
    });
  });
});
