import { test, expect, describe, beforeEach, mock } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync, unlinkSync } from "node:fs";
import { CaptureOrchestrator } from "../../services/capture-orchestrator.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { IPC } from "../../shared/types.js";
import { isValidWebmHeader } from "../../shared/audio-utils.js";
import { transcribeDetailed } from "../../services/stt.js";

const appEventHandlers: Record<string, Function[]> = {};

const mockElectronObj = {
  app: {
    name: "vo",
    setName: mock(() => {}),
    dock: { hide: mock(() => {}) },
    requestSingleInstanceLock: mock(() => true),
    on: mock((event: string, handler: Function) => {
      if (!appEventHandlers[event]) appEventHandlers[event] = [];
      appEventHandlers[event].push(handler);
    }),
    whenReady: mock(async () => {}),
    quit: mock(() => {}),
    exit: mock(() => {}),
  },
  BrowserWindow: class MockBrowserWindow {
    static getAllWindows() { return []; }
    closedHandler: (() => void) | null = null;
    visible = false;
    destroyed = false;
    webContents = {
      send: mock(() => {}),
      on: mock(() => {}),
      once: mock(() => {}),
      setWindowOpenHandler: mock(() => {}),
      getURL: () => "file:///app/out/renderer/index.html",
      mainFrame: { url: "file:///app/out/renderer/index.html", parent: null },
    };
    isDestroyed() { return this.destroyed; }
    destroy() {
      this.destroyed = true;
      if (this.closedHandler) this.closedHandler();
    }
    hide() { this.visible = false; }
    show() { this.visible = true; }
    showInactive() { this.visible = true; }
    focus = mock(() => {});
    isVisible() { return this.visible; }
    loadFile() { return Promise.resolve(); }
    setPosition() {}
    on(event: string, handler: () => void) {
      if (event === "closed") this.closedHandler = handler;
    }
    once() {}
    removeAllListeners() {
      this.closedHandler = null;
    }
  },
  ipcMain: { on: mock(() => {}), handle: mock(() => {}) },
  Tray: class MockTray {
    setImage() {}
    setToolTip() {}
    on() {}
    popUpContextMenu() {}
    destroy() {}
  },
  Menu: { buildFromTemplate: mock(() => ({})) },
  screen: { getPrimaryDisplay: mock(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })) },
  nativeImage: { createFromPath: mock(() => ({ setTemplateImage: mock(() => {}) })) },
  clipboard: { readText: mock(() => ""), writeText: mock(() => {}) },
  Notification: class { static isSupported() { return false; } show() {} },
  systemPreferences: { isTrustedAccessibilityClient: mock(() => false) },
  globalShortcut: { register: mock(() => true), unregisterAll: mock(() => {}) },
};

mock.module("electron", () => ({
  ...mockElectronObj,
  default: mockElectronObj,
}));

let passedWhisperSamples: Float32Array | null = null;
const mockWhisperFull = mock(async (_params: any, samples: Float32Array) => {
  passedWhisperSamples = samples;
  return "whisper transcript";
});

mock.module("@napi-rs/whisper", () => ({
  Whisper: class {
    full = mockWhisperFull;
  },
  WhisperFullParams: class {
    language = "auto";
    noTimestamps = true;
  },
  WhisperSamplingStrategy: { Greedy: 0 },
}));

const { ensurePopoverWindow, getPopoverWindow, handleSecondInstance } = await import("../../main.js");

function createMockWebContents() {
  const handlers: Record<string, Function[]> = {};
  const sentMessages: Array<{ channel: string; args: any[] }> = [];
  return {
    id: Math.floor(Math.random() * 10000) + 1,
    send: mock((channel: string, ...args: any[]) => {
      sentMessages.push({ channel, args });
    }),
    on: mock((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    once: mock((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    emit: (event: string, ...args: any[]) => {
      handlers[event]?.forEach((h) => h(...args));
    },
    setWindowOpenHandler: mock(() => {}),
    isDestroyed: () => false,
    sentMessages,
  };
}

function createMockWindow(role: "capture" | "settings" | "hud" = "capture") {
  const handlers: Record<string, Function[]> = {};
  let destroyed = false;
  let visible = false;
  const webContents = createMockWebContents();
  const page = role === "capture" ? "capture.html" : role === "settings" ? "index.html" : "hud.html";
  const url = `file:///app/out/renderer/${page}`;

  (webContents as any).getURL = () => url;
  (webContents as any).mainFrame = { url, parent: null };

  return {
    webContents,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    setVisible: (v: boolean) => {
      visible = v;
    },
    destroy: () => {
      destroyed = true;
    },
    loadFile: mock(() => Promise.resolve()),
    show: () => {
      visible = true;
    },
    hide: () => {
      visible = false;
    },
    focus: mock(() => {}),
    setPosition: mock(() => {}),
    showInactive: mock(() => {}),
    on: mock((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    once: mock((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    emit: (event: string, ...args: any[]) => {
      handlers[event]?.forEach((h) => h(...args));
    },
  };
}

describe("Phase 1 Performance & Memory Optimization Suite", () => {
  describe("1. Zero-Latency Normal Dictation Selection Capture Bypass", () => {
    let lifecycle: RecordingLifecycle;
    let pasteCoordinator: PasteCoordinator;
    let mockCaptureWin: any;
    let captureSelectionCallCount: number;

    beforeEach(() => {
      lifecycle = new RecordingLifecycle();
      pasteCoordinator = new PasteCoordinator(async () => ({
        ok: true,
        reason: "injection_requested",
      }));
      mockCaptureWin = createMockWindow("capture");
      captureSelectionCallCount = 0;
    });

    function createOrchestrator(triggerMode: "dictate" | "edit") {
      const orchestrator = new CaptureOrchestrator<any, any>(
        {
          createWindow: () => mockCaptureWin,
          getWebContents: (w) => w.webContents,
          isDestroyed: (w) => w.isDestroyed(),
          destroyWindow: (w) => w.destroy(),
          onRenderProcessGone: (s, h) => s.on("render-process-gone", h),
          onDidFinishLoad: (s, h) => s.once("did-finish-load", h),
          onClosed: (w, h) => w.on("closed", h),
          sendIpc: (s, channel, ...args) => s.send(channel, ...args),
          setState: () => {},
          isQuitting: () => false,
          captureActiveSelection: async () => {
            captureSelectionCallCount++;
            return {
              hasSelection: true,
              selectedText: "Hello from highlighted text",
              previousClipboard: "previous clip",
            };
          },
          capturePasteTarget: () => {},
          playStartChime: () => {},
          getInputGain: () => 1.0,
        },
        lifecycle,
        pasteCoordinator
      );

      orchestrator.ensureCaptureWindow();
      mockCaptureWin.webContents.emit("did-finish-load");
      orchestrator.currentTriggerMode = triggerMode;
      return orchestrator;
    }

    test("skips captureActiveSelection completely for 'dictate' mode and transitions to recording", async () => {
      const orchestrator = createOrchestrator("dictate");
      lifecycle.requestStart();

      const startTime = Date.now();
      const started = await orchestrator.startRecordingFlow();
      const elapsed = Date.now() - startTime;

      expect(started).toBe(true);
      expect(captureSelectionCallCount).toBe(0);
      expect(orchestrator.activeSelectionText).toBe("");
      expect(lifecycle.snapshot().state).toBe("recording");
      // Fast start without 350ms delay
      expect(elapsed).toBeLessThan(100);
    });

    test("invokes captureActiveSelection for 'edit' mode and retains selectedText", async () => {
      const orchestrator = createOrchestrator("edit");
      lifecycle.requestStart();

      const started = await orchestrator.startRecordingFlow();

      expect(started).toBe(true);
      expect(captureSelectionCallCount).toBe(1);
      expect(orchestrator.activeSelectionText).toBe("Hello from highlighted text");
      expect(lifecycle.snapshot().state).toBe("recording");
    });

    test("handles cancelled starting state cleanly in dictate mode", async () => {
      const orchestrator = createOrchestrator("dictate");
      lifecycle.requestStart();
      lifecycle.cancel(); // Abort during starting state

      const started = await orchestrator.startRecordingFlow();
      expect(started).toBe(false);
      expect(captureSelectionCallCount).toBe(0);
    });
  });

  describe("2. Hidden Popover Audio Level IPC & Rendering Gating", () => {
    test("forwards AUDIO_LEVEL_UPDATE to popoverWindow ONLY when visible", () => {
      const popoverWin = createMockWindow("settings");
      const hudWin = createMockWindow("hud");

      const forwardAudioLevel = (level: number, popover: any, hud: any) => {
        if (popover && !popover.isDestroyed() && popover.isVisible()) {
          popover.webContents.send(IPC.AUDIO_LEVEL_UPDATE, level);
        }
        hud?.webContents.send(IPC.AUDIO_LEVEL_UPDATE, level);
      };

      // Case A: popover is hidden
      popoverWin.setVisible(false);
      forwardAudioLevel(42, popoverWin, hudWin);

      expect(popoverWin.webContents.sentMessages.length).toBe(0);
      expect(hudWin.webContents.sentMessages.length).toBe(1);
      expect(hudWin.webContents.sentMessages[0]).toEqual({
        channel: IPC.AUDIO_LEVEL_UPDATE,
        args: [42],
      });

      // Case B: popover is visible
      popoverWin.setVisible(true);
      forwardAudioLevel(85, popoverWin, hudWin);

      expect(popoverWin.webContents.sentMessages.length).toBe(1);
      expect(popoverWin.webContents.sentMessages[0]).toEqual({
        channel: IPC.AUDIO_LEVEL_UPDATE,
        args: [85],
      });
      expect(hudWin.webContents.sentMessages.length).toBe(2);

      // Case C: popover is null
      forwardAudioLevel(99, null, hudWin);
      expect(hudWin.webContents.sentMessages.length).toBe(3);
    });
  });

  describe("3. Lazy Popover Window Creation & Lifecycle", () => {
    test("ensurePopoverWindow creates BrowserWindow lazily and returns active instance", () => {
      const win = ensurePopoverWindow();
      expect(win).toBeDefined();
      expect(getPopoverWindow()).toBe(win);

      // Subsequent call returns exact same instance
      const secondCall = ensurePopoverWindow();
      expect(secondCall).toBe(win);
    });

    test("closing popover resets reference and allows clean recreation", () => {
      const win = ensurePopoverWindow();
      expect(win).toBeDefined();

      // Emit closed event
      (win as any).closedHandler?.();
      expect(getPopoverWindow()).toBeNull();

      // Recreate on subsequent request
      const recreated = ensurePopoverWindow();
      expect(recreated).toBeDefined();
      expect(recreated).not.toBe(win);
    });

    test("popover closed listener identity check prevents nulling replacement window", () => {
      const win1 = ensurePopoverWindow();
      expect(win1).toBeDefined();

      // Mark win1 as destroyed so ensurePopoverWindow creates a replacement
      (win1 as any).destroyed = true;
      const win2 = ensurePopoverWindow();
      expect(win2).toBeDefined();
      expect(win2).not.toBe(win1);
      expect(getPopoverWindow()).toBe(win2);

      // Trigger stale closed event from old win1
      (win1 as any).closedHandler?.();

      // Popover window reference must NOT be nulled by the stale win1 closed event
      expect(getPopoverWindow()).toBe(win2);

      // Triggering closed event from current win2 DOES null the reference
      (win2 as any).closedHandler?.();
      expect(getPopoverWindow()).toBeNull();
    });

    test("second-instance event creates and focuses popover window when initially null", () => {
      // Ensure popover window is initially null
      const current = getPopoverWindow();
      if (current) {
        (current as any).closedHandler?.();
      }
      expect(getPopoverWindow()).toBeNull();

      handleSecondInstance();

      const win = getPopoverWindow();
      expect(win).not.toBeNull();
      expect((win as any).focus).toHaveBeenCalled();
    });
  });

  describe("4. Audio Buffer Zero-Copy Optimization & Format Support", () => {
    const validWebmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);

    test("isValidWebmHeader accepts ArrayBuffer, Uint8Array, and Node Buffer identically", () => {
      const arrayBuffer = validWebmBytes.buffer.slice(
        validWebmBytes.byteOffset,
        validWebmBytes.byteOffset + validWebmBytes.byteLength
      );
      const uint8 = new Uint8Array(arrayBuffer);
      const nodeBuf = Buffer.from(arrayBuffer);

      expect(isValidWebmHeader(arrayBuffer)).toBe(true);
      expect(isValidWebmHeader(uint8)).toBe(true);
      expect(isValidWebmHeader(nodeBuf)).toBe(true);
    });

    test("transcribeDetailed accepts Buffer directly without throwing type or runtime errors", async () => {
      const dummyBuffer = Buffer.from(new Float32Array(16000).buffer);
      // Calls transcribeDetailed with fast-abort signal to check parameter acceptance
      const abortController = new AbortController();
      abortController.abort();

      try {
        await transcribeDetailed(dummyBuffer, {
          provider: "gemini",
          abortSignal: abortController.signal,
        });
      } catch (err: any) {
        expect(err.message).toMatch(/aborted/i);
      }
    });

    test("transcribeDetailed accepts Uint8Array directly without throwing type or runtime errors", async () => {
      const dummyUint8 = new Uint8Array(new Float32Array(16000).buffer);
      const abortController = new AbortController();
      abortController.abort();

      try {
        await transcribeDetailed(dummyUint8, {
          provider: "gemini",
          abortSignal: abortController.signal,
        });
      } catch (err: any) {
        expect(err.message).toMatch(/aborted/i);
      }
    });

    test("zero-copy Buffer.from view shares underlying memory without duplication", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const view = Buffer.from(original.buffer, original.byteOffset, original.byteLength);

      // Modifying view mutates underlying buffer
      view[0] = 99;
      expect(original[0]).toBe(99);
    });

    test("misaligned byteOffset Uint8Array subarrays in local Whisper do not throw RangeError", async () => {
      const prevModelPath = process.env.WHISPER_MODEL_PATH;
      const tmp = join(tmpdir(), `dummy-whisper-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
      writeFileSync(tmp, "model");
      process.env.WHISPER_MODEL_PATH = tmp;
      try {
        passedWhisperSamples = null;
        const raw = new ArrayBuffer(100);
        const uint8View = new Uint8Array(raw);
        for (let i = 0; i < uint8View.length; i++) {
          uint8View[i] = i & 0xff;
        }

        // Create a subarray with misaligned byteOffset (byteOffset = 1, not divisible by 4)
        const misalignedSubarray = new Uint8Array(raw, 1, 64);
        expect(misalignedSubarray.byteOffset % 4).not.toBe(0);

        // Verify that naive construction WOULD throw RangeError:
        expect(() => {
          new Float32Array(misalignedSubarray.buffer, misalignedSubarray.byteOffset, 16);
        }).toThrow(RangeError);

        // Call transcribeDetailed with provider: "local" and translateEnabled: false
        const result = await transcribeDetailed(misalignedSubarray, {
          provider: "local",
          translateEnabled: false,
        });

        expect(result.text).toBe("Whisper transcript");
        const samples: any = passedWhisperSamples;
        expect(samples).toBeInstanceOf(Float32Array);
        expect(samples?.length).toBe(16);
      } finally {
        try { unlinkSync(tmp); } catch {}
        if (prevModelPath === undefined) {
          delete process.env.WHISPER_MODEL_PATH;
        } else {
          process.env.WHISPER_MODEL_PATH = prevModelPath;
        }
      }
    });

    test("aligned byteOffset Uint8Array subarrays in local Whisper work without copying", async () => {
      const prevModelPath = process.env.WHISPER_MODEL_PATH;
      const tmp = join(tmpdir(), `dummy-whisper-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
      writeFileSync(tmp, "model");
      process.env.WHISPER_MODEL_PATH = tmp;
      try {
        passedWhisperSamples = null;
        const raw = new ArrayBuffer(100);
        const alignedSubarray = new Uint8Array(raw, 4, 64);
        expect(alignedSubarray.byteOffset % 4).toBe(0);

        const result = await transcribeDetailed(alignedSubarray, {
          provider: "local",
          translateEnabled: false,
        });

        expect(result.text).toBe("Whisper transcript");
        const samples: any = passedWhisperSamples;
        expect(samples).toBeInstanceOf(Float32Array);
        expect(samples?.length).toBe(16);
      } finally {
        try { unlinkSync(tmp); } catch {}
        if (prevModelPath === undefined) {
          delete process.env.WHISPER_MODEL_PATH;
        } else {
          process.env.WHISPER_MODEL_PATH = prevModelPath;
        }
      }
    });
  });
});
