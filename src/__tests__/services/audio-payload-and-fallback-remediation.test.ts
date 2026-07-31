import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { teardownAudio, registerCaptureListeners, resetAudioStateForTest } from "../../renderer/capture.js";
import {
  isValidWebmHeader,
  getBestSupportedMimeType,
  MAX_RECORDING_DURATION_MS,
  MAX_RECORDING_CHUNKS,
  MAX_RECORDING_BYTE_SIZE,
  MAX_STT_PAYLOAD_BYTES,
  MIN_STT_PAYLOAD_BYTES,
  WEBM_EBML_MAGIC,
} from "../../shared/audio-utils.js";
import { CaptureOrchestrator } from "../../services/capture-orchestrator.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = {};
}

class FakeTrack {
  public readyState: "live" | "ended" = "live";
  public label: string;
  public onended: (() => void) | null = null;
  public stopCount = 0;

  constructor(label = "System Default Microphone") {
    this.label = label;
  }

  stop() {
    this.stopCount++;
    this.readyState = "ended";
  }

  emitEnded() {
    this.readyState = "ended";
    if (this.onended) this.onended();
  }
}

class FakeStream {
  public active = true;
  public tracks: FakeTrack[];

  constructor(tracks?: FakeTrack[]) {
    this.tracks = tracks ?? [new FakeTrack()];
  }

  getAudioTracks() {
    return this.tracks;
  }
}

class FakeAudioNode {
  connect() {}
  disconnect() {}
}

class FakeGainNode extends FakeAudioNode {
  public gain = {
    value: 1.0,
    setValueAtTime: (val: number) => {
      this.gain.value = val;
    },
  };
}

class FakeAnalyserNode extends FakeAudioNode {
  public fftSize = 256;
  public frequencyBinCount = 128;

  getFloatTimeDomainData(buffer: Float32Array) {
    buffer.fill(0.01);
  }

  getByteFrequencyData(buffer: Uint8Array) {
    buffer.fill(10);
  }
}

class FakeAudioContext {
  public state: "suspended" | "running" | "closed" = "suspended";
  public currentTime = 0;

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }

  createMediaStreamSource() {
    return new FakeAudioNode();
  }

  createGain() {
    return new FakeGainNode();
  }

  createAnalyser() {
    return new FakeAnalyserNode();
  }

  createDynamicsCompressor() {
    return new FakeAudioNode();
  }

  createMediaStreamDestination() {
    return { stream: new FakeStream() };
  }
}

class FakeMediaRecorder {
  public state: "inactive" | "recording" = "inactive";
  public mimeType: string;
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;
  public onerror: ((event: { error: any }) => void) | null = null;
  public startCount = 0;
  public stopCount = 0;

  static supportedMimes: Record<string, boolean> = {
    "audio/webm;codecs=opus": true,
    "audio/webm": true,
  };

  static isTypeSupported(mime: string): boolean {
    return !!FakeMediaRecorder.supportedMimes[mime];
  }

  constructor(_stream: any, options?: any) {
    this.mimeType = options?.mimeType || "audio/webm;codecs=opus";
    (FakeMediaRecorder as any).lastInstance = this;
  }

  start(_timeslice?: number) {
    this.startCount++;
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    this.stopCount++;
    this.state = "inactive";
    if (this.onstop) {
      this.onstop();
    }
  }

  emitData(blob: Blob) {
    if (this.ondataavailable) {
      this.ondataavailable({ data: blob });
    }
  }
}

function createValidWebmBuffer(size = 2000): ArrayBuffer {
  const buf = new Uint8Array(size);
  buf[0] = WEBM_EBML_MAGIC[0];
  buf[1] = WEBM_EBML_MAGIC[1];
  buf[2] = WEBM_EBML_MAGIC[2];
  buf[3] = WEBM_EBML_MAGIC[3];
  return buf.buffer;
}

function createMalformedBuffer(size = 2000): ArrayBuffer {
  const buf = new Uint8Array(size);
  buf.fill(0xff);
  return buf.buffer;
}

let startRecordingHandler: ((format: string, inputGain: number, sequenceId: number) => Promise<void>) | null = null;
let stopRecordingHandler: ((ensureMin?: boolean) => void) | null = null;

const sentErrors: { error: string; sequenceId: number }[] = [];
const startReadyPayloads: { sequenceId: number; deviceStatus?: string }[] = [];
const startFailedPayloads: { sequenceId: number; error: string }[] = [];
const sentData: ArrayBuffer[] = [];

describe("VO Remediation PR-11: Device Fallback and Recording Payload Remediation Suite", () => {
  let originalMediaDevices: any;
  let originalMediaRecorder: any;
  let originalAudioContext: any;
  let configuredDeviceId = "default";
  let getUserMediaCallLogs: any[] = [];

  beforeEach(() => {
    sentErrors.length = 0;
    startReadyPayloads.length = 0;
    startFailedPayloads.length = 0;
    sentData.length = 0;
    getUserMediaCallLogs.length = 0;
    configuredDeviceId = "default";
    FakeMediaRecorder.supportedMimes = {
      "audio/webm;codecs=opus": true,
      "audio/webm": true,
    };
    (FakeMediaRecorder as any).lastInstance = undefined;

    originalMediaDevices = (globalThis as any).navigator?.mediaDevices;
    originalMediaRecorder = (globalThis as any).MediaRecorder;
    originalAudioContext = (globalThis as any).AudioContext;

    (globalThis as any).MediaRecorder = FakeMediaRecorder;
    (globalThis as any).AudioContext = FakeAudioContext;

    const mockMediaDevices = {
      getUserMedia: async (constraints: any) => {
        getUserMediaCallLogs.push(constraints);
        if (constraints?.audio?.deviceId?.exact === "non-existent-mic") {
          const err = new Error("Requested device not found");
          err.name = "NotFoundError";
          throw err;
        }
        if (constraints?.audio?.deviceId?.exact === "overconstrained-mic") {
          const err = new Error("Constraints impossible to satisfy");
          err.name = "OverconstrainedError";
          throw err;
        }
        if (constraints?.audio?.deviceId?.exact === "permission-denied-mic") {
          const err = new Error("Permission denied");
          err.name = "NotAllowedError";
          throw err;
        }
        if (constraints?.audio?.deviceId?.exact === "security-error-mic") {
          const err = new Error("Security policy blocked mic access");
          err.name = "SecurityError";
          throw err;
        }
        if (constraints?.audio?.deviceId?.exact === "abort-error-mic") {
          const err = new Error("Microphone access aborted");
          err.name = "AbortError";
          throw err;
        }
        if (constraints?.audio?.deviceId?.exact === "hardware-failure-mic") {
          const err = new Error("Hardware failure / mic busy");
          err.name = "NotReadableError";
          throw err;
        }
        return new FakeStream([new FakeTrack("System Default Microphone")]);
      },
      addEventListener: () => {},
    };

    if (typeof (globalThis as any).navigator === "undefined") {
      (globalThis as any).navigator = {};
    }
    (globalThis as any).navigator.mediaDevices = mockMediaDevices;

    const mockPiVoice = {
      getConfig: () => Promise.resolve({ audioDeviceId: configuredDeviceId, dictationMode: "hold" }),
      sendRecordingData: (data: ArrayBuffer) => {
        sentData.push(data);
      },
      sendRecordingError: (error: string, sequenceId: number) => {
        sentErrors.push({ error, sequenceId });
      },
      sendRecordingStartReady: (sequenceId: number, deviceStatus?: string) => {
        startReadyPayloads.push({ sequenceId, deviceStatus });
      },
      sendRecordingStartFailed: (sequenceId: number, error: string) => {
        startFailedPayloads.push({ sequenceId, error });
      },
      sendRecordingStopped: () => {},
      sendAudioLevelUpdate: () => {},
      onStartRecording: (cb: any) => {
        startRecordingHandler = cb;
        return () => {};
      },
      onStopRecording: (cb: any) => {
        stopRecordingHandler = cb;
        return () => {};
      },
      onCancelRecording: () => () => {},
      onGainUpdate: () => () => {},
    };

    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).window.piVoice = mockPiVoice;

    resetAudioStateForTest();
    registerCaptureListeners();
  });

  afterEach(() => {
    resetAudioStateForTest();
    if (originalMediaDevices) {
      (globalThis as any).navigator.mediaDevices = originalMediaDevices;
    }
    if (originalMediaRecorder) {
      (globalThis as any).MediaRecorder = originalMediaRecorder;
    } else {
      delete (globalThis as any).MediaRecorder;
    }
    if (originalAudioContext) {
      (globalThis as any).AudioContext = originalAudioContext;
    } else {
      delete (globalThis as any).AudioContext;
    }
  });

  describe("WebM Magic Header & MIME Utility Functions", () => {
    test("isValidWebmHeader recognizes EBML magic bytes [0x1A, 0x45, 0xDF, 0xA3] across input types and offsets", () => {
      const validBuffer = createValidWebmBuffer(100);
      const validUint8 = new Uint8Array(validBuffer);
      const malformed = createMalformedBuffer(100);
      const empty = new ArrayBuffer(0);
      const short = new Uint8Array([0x1a, 0x45, 0xdf]).buffer;

      // DataView test
      const dataView = new DataView(validBuffer);
      // Offset ArrayBufferView test
      const fullBuffer = new Uint8Array(200);
      fullBuffer.set([0x1a, 0x45, 0xdf, 0xa3], 10);
      const offsetSubView = new Uint8Array(fullBuffer.buffer, 10, 50);

      expect(isValidWebmHeader(validBuffer)).toBe(true);
      expect(isValidWebmHeader(validUint8)).toBe(true);
      expect(isValidWebmHeader(dataView)).toBe(true);
      expect(isValidWebmHeader(offsetSubView)).toBe(true);

      expect(isValidWebmHeader(malformed)).toBe(false);
      expect(isValidWebmHeader(empty)).toBe(false);
      expect(isValidWebmHeader(short)).toBe(false);
      expect(isValidWebmHeader(null)).toBe(false);
      expect(isValidWebmHeader(undefined)).toBe(false);
      expect(isValidWebmHeader(12345)).toBe(false);
      expect(isValidWebmHeader({ invalid: "type" })).toBe(false);
    });

    test("getBestSupportedMimeType requires explicit isTypeSupported function and returns null if unavailable", () => {
      const best = getBestSupportedMimeType((mime) => mime === "audio/webm;codecs=opus");
      expect(best).toBe("audio/webm;codecs=opus");

      const fallback = getBestSupportedMimeType((mime) => mime === "audio/webm");
      expect(fallback).toBe("audio/webm");

      const none = getBestSupportedMimeType(() => false);
      expect(none).toBeNull();

      const strictlyUnavailable = getBestSupportedMimeType((_mime) => false);
      expect(strictlyUnavailable).toBeNull();
    });
  });

  describe("AUD-03 Exact-Device Acquisition & Fallback Policy", () => {
    test("falls back to system default only for NotFoundError and OverconstrainedError and emits generic status", async () => {
      configuredDeviceId = "non-existent-mic";
      await startRecordingHandler?.("webm", 1.0, 101);

      expect(getUserMediaCallLogs.length).toBe(2);
      expect(getUserMediaCallLogs[0].audio.deviceId.exact).toBe("non-existent-mic");
      expect(getUserMediaCallLogs[1].audio.deviceId).toBeUndefined();

      expect(startReadyPayloads.length).toBe(1);
      expect(startReadyPayloads[0]!.sequenceId).toBe(101);
      expect(startReadyPayloads[0]!.deviceStatus).toBe("configured microphone unavailable; using default microphone");
    });

    test("falls back cleanly on OverconstrainedError", async () => {
      configuredDeviceId = "overconstrained-mic";
      await startRecordingHandler?.("webm", 1.0, 102);

      expect(getUserMediaCallLogs.length).toBe(2);
      expect(getUserMediaCallLogs[0].audio.deviceId.exact).toBe("overconstrained-mic");
      expect(startReadyPayloads[0]!.deviceStatus).toBe("configured microphone unavailable; using default microphone");
    });

    test("DOES NOT fall back for NotAllowedError (permission denied) and reports start failed", async () => {
      configuredDeviceId = "permission-denied-mic";
      await startRecordingHandler?.("webm", 1.0, 103);

      expect(getUserMediaCallLogs.length).toBe(1);
      expect(startReadyPayloads.length).toBe(0);
      expect(startFailedPayloads.length).toBe(1);
      expect(startFailedPayloads[0]!.sequenceId).toBe(103);
      expect(startFailedPayloads[0]!.error).toContain("Microphone access error: Permission denied");
    });

    test("DOES NOT fall back for SecurityError, AbortError, or NotReadableError (hardware failure)", async () => {
      configuredDeviceId = "security-error-mic";
      await startRecordingHandler?.("webm", 1.0, 104);

      expect(getUserMediaCallLogs.length).toBe(1);
      expect(startFailedPayloads.length).toBe(1);
      expect(startFailedPayloads[0]!.error).toContain("Security policy blocked mic access");

      startFailedPayloads.length = 0;
      getUserMediaCallLogs.length = 0;

      configuredDeviceId = "abort-error-mic";
      await startRecordingHandler?.("webm", 1.0, 105);

      expect(getUserMediaCallLogs.length).toBe(1);
      expect(startFailedPayloads.length).toBe(1);
      expect(startFailedPayloads[0]!.error).toContain("Microphone access aborted");

      startFailedPayloads.length = 0;
      getUserMediaCallLogs.length = 0;

      configuredDeviceId = "hardware-failure-mic";
      await startRecordingHandler?.("webm", 1.0, 106);

      expect(getUserMediaCallLogs.length).toBe(1);
      expect(startFailedPayloads.length).toBe(1);
      expect(startFailedPayloads[0]!.error).toContain("Hardware failure / mic busy");
    });
  });

  describe("AUD-05 MIME Type Selection & MediaRecorder Pre-Check", () => {
    test("fails visibly before mic acquisition when no WebM/Opus MIME is supported", async () => {
      FakeMediaRecorder.supportedMimes = {};

      await startRecordingHandler?.("webm", 1.0, 201);

      expect(getUserMediaCallLogs.length).toBe(0);
      expect(startFailedPayloads.length).toBe(1);
      expect(startFailedPayloads[0]!.error).toBe("No supported WebM/Opus audio MIME type found");
    });
  });

  describe("AUD-05 Payload Bounds, Empty Chunks, and Header Verification", () => {
    test("ignores empty chunks with size 0", async () => {
      await startRecordingHandler?.("webm", 1.0, 301);
      const recorder = (FakeMediaRecorder as any).lastInstance;
      expect(recorder).toBeDefined();

      const emptyBlob = new Blob([], { type: "audio/webm" });
      recorder.emitData(emptyBlob);

      const validBlob = new Blob([createValidWebmBuffer(2000)], { type: "audio/webm" });
      recorder.emitData(validBlob);

      await new Promise((r) => setTimeout(r, 350));
      stopRecordingHandler?.(false);
      await new Promise((r) => setTimeout(r, 350));

      expect(sentData.length).toBe(1);
      expect(sentErrors.length).toBe(0);
    });

    test("rejects malformed recording payload missing WebM EBML header", async () => {
      await startRecordingHandler?.("webm", 1.0, 302);
      const recorder = (FakeMediaRecorder as any).lastInstance;

      const malformedBlob = new Blob([createMalformedBuffer(2000)], { type: "audio/webm" });
      recorder.emitData(malformedBlob);

      await new Promise((r) => setTimeout(r, 350));
      stopRecordingHandler?.(false);
      await new Promise((r) => setTimeout(r, 350));

      expect(sentData.length).toBe(0);
      expect(sentErrors.length).toBe(1);
      expect(sentErrors[0]!.error).toBe("Malformed recording payload (missing WebM header)");
    });

    test("rejects oversized recording payloads exceeding MAX_RECORDING_BYTE_SIZE in renderer", async () => {
      await startRecordingHandler?.("webm", 1.0, 303);
      const recorder = (FakeMediaRecorder as any).lastInstance;

      const hugeBlob = new Blob([new Uint8Array(MAX_RECORDING_BYTE_SIZE + 1000)], { type: "audio/webm" });
      recorder.emitData(hugeBlob);

      expect(sentErrors.length).toBe(1);
      expect(sentErrors[0]!.error).toBe("Recording payload size limit exceeded");
    });

    test("rejects excessive chunk counts exceeding MAX_RECORDING_CHUNKS in renderer", async () => {
      await startRecordingHandler?.("webm", 1.0, 304);
      const recorder = (FakeMediaRecorder as any).lastInstance;

      const chunkBlob = new Blob([createValidWebmBuffer(10)], { type: "audio/webm" });
      for (let i = 0; i <= MAX_RECORDING_CHUNKS; i++) {
        recorder.emitData(chunkBlob);
        if (sentErrors.length > 0) break;
      }

      expect(sentErrors.length).toBe(1);
      expect(sentErrors[0]!.error).toBe("Recording payload size limit exceeded");
    });

    test("enforces controlled time/real duration termination exceeding MAX_RECORDING_DURATION_MS", async () => {
      const realNow = Date.now;
      try {
        const startTime = realNow();
        let mockedNow = startTime;
        Date.now = () => mockedNow;

        await startRecordingHandler?.("webm", 1.0, 305);
        const recorder = (FakeMediaRecorder as any).lastInstance;
        expect(recorder).toBeDefined();

        const validBlob = new Blob([createValidWebmBuffer(2000)], { type: "audio/webm" });
        recorder.emitData(validBlob);

        // Advance time past 5 minutes (300,000 ms)
        mockedNow = startTime + MAX_RECORDING_DURATION_MS + 1000;

        stopRecordingHandler?.(false);
        await new Promise((r) => setTimeout(r, 350));

        expect(sentData.length).toBe(0);
        expect(sentErrors.length).toBe(1);
        expect(sentErrors[0]!.error).toBe("Recording duration limit exceeded");
      } finally {
        Date.now = realNow;
      }
    });

    test("accepts valid post-roll WebM recording and emits arrayBuffer data", async () => {
      await startRecordingHandler?.("webm", 1.0, 306);
      const recorder = (FakeMediaRecorder as any).lastInstance;

      const validBuffer = createValidWebmBuffer(3000);
      const validBlob = new Blob([validBuffer], { type: "audio/webm" });
      recorder.emitData(validBlob);

      await new Promise((r) => setTimeout(r, 350));
      stopRecordingHandler?.(false);
      await new Promise((r) => setTimeout(r, 350));

      expect(sentData.length).toBe(1);
      expect(isValidWebmHeader(sentData[0]!)).toBe(true);
      expect(sentErrors.length).toBe(0);
    });
  });

  describe("Capture Orchestrator Fallback Device Status Retention", () => {
    test("preserves fallback device status on orchestrator when start recording flow completes", async () => {
      const lifecycle = new RecordingLifecycle();
      const stateLog: { state: string; msg?: string }[] = [];

      const listeners = new Map<string, Function>();
      const mockWebContents = {
        id: 99,
        getURL: () => "file:///app/out/renderer/capture.html",
        mainFrame: { url: "file:///app/out/renderer/capture.html", parent: null },
        send: () => {},
        once: (evt: string, fn: Function) => listeners.set(evt, fn),
        on: (evt: string, fn: Function) => listeners.set(evt, fn),
      };
      const mockWin = {
        webContents: mockWebContents,
        isDestroyed: () => false,
      };

      const orchestrator = new CaptureOrchestrator({
        createWindow: () => mockWin as any,
        getWebContents: () => mockWebContents as any,
        isDestroyed: () => false,
        destroyWindow: () => {},
        onRenderProcessGone: () => {},
        onDidFinishLoad: (sender: any, handler: () => void) => {
          handler();
        },
        onClosed: () => {},
        sendIpc: () => {},
        isQuitting: () => false,
        captureActiveSelection: async () => ({ hasSelection: false, selectedText: "", previousClipboard: { text: "" } }),
        capturePasteTarget: () => ({ ok: true }),
        setState: (state: string, msg?: string) => {
          stateLog.push({ state, msg });
        },
        playStartChime: () => {},
        getInputGain: () => 1.0,
      }, lifecycle);

      orchestrator.ensureCaptureWindow();
      const gen = orchestrator.controller.session.attach(mockWebContents as any);
      orchestrator.controller.session.acknowledgeReady(mockWebContents as any, gen);

      const reqRes = lifecycle.requestStart();
      orchestrator.setSequenceDeviceStatus(reqRes.sequenceId, "configured microphone unavailable; using default microphone");

      await orchestrator.startRecordingFlow();

      const lastState = stateLog[stateLog.length - 1];
      expect(lastState?.state).toBe("recording");
      expect(lastState?.msg).toBe("configured microphone unavailable; using default microphone");
    });
  });
});
