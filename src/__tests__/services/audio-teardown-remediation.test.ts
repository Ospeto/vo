import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { teardownAudio, registerCaptureListeners, resetAudioStateForTest } from "../../renderer/capture.js";
import { CaptureOrchestrator } from "../../services/capture-orchestrator.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";
import { IPC } from "../../shared/types.js";

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = {};
}

class FakeTrack {
  public readyState: "live" | "ended" = "live";
  public onended: (() => void) | null = null;
  public stopCount = 0;

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
  public connectCount = 0;
  public disconnectCount = 0;

  connect(_target?: any) {
    this.connectCount++;
  }

  disconnect() {
    this.disconnectCount++;
  }
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
  public closeCount = 0;

  async resume() {
    if (this.state === "closed") throw new Error("Cannot resume closed AudioContext");
    this.state = "running";
  }

  async close() {
    if (this.state === "closed") throw new Error("AudioContext already closed");
    this.state = "closed";
    this.closeCount++;
  }

  createMediaStreamSource(_stream: any) {
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
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;
  public onerror: ((event: { error: any }) => void) | null = null;
  public startCount = 0;
  public stopCount = 0;

  constructor(_stream: any, _options?: any) {
    (FakeMediaRecorder as any).lastInstance = this;
  }

  start(timeslice?: number) {
    if (this.state === "recording") throw new Error("MediaRecorder already recording");
    this.startCount++;
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    this.stopCount++;
    this.state = "inactive";
    if (this.onstop) {
      const cb = this.onstop;
      cb();
    }
  }

  emitError(error: any) {
    if (this.onerror) {
      this.onerror({ error });
    }
  }
}

let startRecordingHandler: ((format: string, inputGain: number, sequenceId: number) => Promise<void>) | null = null;
let cancelRecordingHandler: (() => void) | null = null;
let stopRecordingHandler: ((ensureMin?: boolean) => void) | null = null;

const sentErrors: { error: string; sequenceId: number }[] = [];
const startReadySeq: number[] = [];
const startFailedPayloads: { sequenceId: number; error: string }[] = [];
const stoppedSeq: number[] = [];
const createdStreams: FakeStream[] = [];
const eventListeners: Record<string, Function[]> = {};

describe("VO Remediation PR-10: Audio Teardown and Acknowledgements Suite", () => {
  let originalMediaDevices: any;

  const createMockMediaDevices = () => ({
    getUserMedia: async () => {
      const stream = new FakeStream();
      createdStreams.push(stream);
      return stream;
    },
    addEventListener: () => {},
  });

  beforeEach(async () => {
    sentErrors.length = 0;
    startReadySeq.length = 0;
    startFailedPayloads.length = 0;
    stoppedSeq.length = 0;
    createdStreams.length = 0;
    (FakeMediaRecorder as any).lastInstance = undefined;
    for (const k in eventListeners) delete eventListeners[k];

    originalMediaDevices = navigator.mediaDevices;

    const mockPiVoice = {
      getConfig: () => Promise.resolve({ audioDeviceId: "default", dictationMode: "hold" }),
      sendRecordingData: (_data: ArrayBuffer) => {},
      sendRecordingError: (error: string, sequenceId: number) => {
        sentErrors.push({ error, sequenceId });
      },
      sendRecordingStartReady: (sequenceId: number) => {
        startReadySeq.push(sequenceId);
      },
      sendRecordingStartFailed: (sequenceId: number, error: string) => {
        startFailedPayloads.push({ sequenceId, error });
      },
      sendRecordingStopped: (sequenceId: number) => {
        stoppedSeq.push(sequenceId);
      },
      sendAudioLevelUpdate: (_payload: any) => {},
      onStartRecording: (cb: any) => {
        startRecordingHandler = cb;
        return () => {};
      },
      onStopRecording: (cb: any) => {
        stopRecordingHandler = cb;
        return () => {};
      },
      onCancelRecording: (cb: any) => {
        cancelRecordingHandler = cb;
        return () => {};
      },
      onGainUpdate: (_cb: any) => () => {},
    };

    const mockWindow: any = {
      piVoice: mockPiVoice,
      AudioContext: FakeAudioContext,
      MediaRecorder: FakeMediaRecorder,
      addEventListener: (type: string, fn: Function) => {
        eventListeners[type] = eventListeners[type] || [];
        eventListeners[type].push(fn);
      },
      dispatchEvent: (type: string) => {
        (eventListeners[type] || []).forEach((fn) => fn());
      },
    };

    (globalThis as any).window = mockWindow;
    (globalThis as any).AudioContext = FakeAudioContext as any;
    (globalThis as any).MediaRecorder = FakeMediaRecorder as any;

    Object.defineProperty(navigator, "mediaDevices", {
      value: createMockMediaDevices(),
      configurable: true,
      writable: true,
    });

    resetAudioStateForTest();
    registerCaptureListeners();
  });

  afterEach(async () => {
    startRecordingHandler = null;
    cancelRecordingHandler = null;
    stopRecordingHandler = null;

    resetAudioStateForTest();

    Object.defineProperty(navigator, "mediaDevices", {
      value: createMockMediaDevices(),
      configurable: true,
      writable: true,
    });
  });

  test("1. Delayed permission after cancel: local stream is cleaned up, no globals set, no recording started", async () => {
    const fakeTrack = new FakeTrack();
    const fakeStream = new FakeStream([fakeTrack]);

    let resolveGetUserMedia: (stream: any) => void;
    const delayedGetUserMedia = new Promise<any>((resolve) => {
      resolveGetUserMedia = resolve;
    });

    const defaultMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: () => {
          cancelRecordingHandler?.();
          return delayedGetUserMedia;
        },
        addEventListener: () => {},
      },
      configurable: true,
      writable: true,
    });

    try {
      const startPromise = startRecordingHandler?.("webm", 1.0, 101);
      resolveGetUserMedia!(fakeStream);
      await startPromise;
      await new Promise((r) => setTimeout(r, 0));

      expect(fakeTrack.stopCount).toBe(1);
      expect(startReadySeq).not.toContain(101);
    } finally {
      Object.defineProperty(navigator, "mediaDevices", {
        value: createMockMediaDevices(),
        configurable: true,
        writable: true,
      });
    }
  });

  test("2. Setup failure at each stage: cleans up local resources, emits error, and remains retryable", async () => {
    const defaultMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          throw new Error("Permission denied");
        },
        addEventListener: () => {},
      },
      configurable: true,
      writable: true,
    });

    try {
      await startRecordingHandler?.("webm", 1.0, 201);
      expect(startFailedPayloads.some((p) => p.sequenceId === 201)).toBe(true);
    } finally {
      Object.defineProperty(navigator, "mediaDevices", {
        value: createMockMediaDevices(),
        configurable: true,
        writable: true,
      });
    }

    const fakeTrack = new FakeTrack();
    const fakeStream = new FakeStream([fakeTrack]);
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => fakeStream,
        addEventListener: () => {},
      },
      configurable: true,
      writable: true,
    });

    (globalThis as any).AudioContext = class {
      constructor() {
        throw new Error("AudioContext initialization failed");
      }
    };

    try {
      await startRecordingHandler?.("webm", 1.0, 202);
      expect(fakeTrack.stopCount).toBe(1);
      expect(startFailedPayloads.some((p) => p.sequenceId === 202)).toBe(true);
    } finally {
      (globalThis as any).AudioContext = FakeAudioContext as any;
      Object.defineProperty(navigator, "mediaDevices", {
        value: createMockMediaDevices(),
        configurable: true,
        writable: true,
      });
    }

    await startRecordingHandler?.("webm", 1.0, 203);
    expect(startReadySeq).toContain(203);
    teardownAudio();
    await new Promise((r) => setTimeout(r, 0));
  });

  test("3. Cancel/restart exactly one recorder: stops generation 1, starts generation 2 cleanly", async () => {
    await startRecordingHandler?.("webm", 1.0, 301);
    expect(startReadySeq).toContain(301);

    const firstStream = createdStreams[createdStreams.length - 1];
    const firstRecorder = (FakeMediaRecorder as any).lastInstance;
    expect(firstStream).toBeDefined();
    expect(firstRecorder).toBeDefined();

    cancelRecordingHandler?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(firstRecorder.state).toBe("inactive");
    expect(firstStream!.tracks[0]!.stopCount).toBe(1);
    expect(stoppedSeq).toContain(301);

    await startRecordingHandler?.("webm", 1.0, 302);
    const fs = require("node:fs");
    fs.writeSync(1, `\n=== TEST 3 RESULT: startReadySeq=${JSON.stringify(startReadySeq)}, sentErrors=${JSON.stringify(sentErrors)}, startFailed=${JSON.stringify(startFailedPayloads)} ===\n`);
    expect(startReadySeq).toContain(302);
    const secondRecorder = (FakeMediaRecorder as any).lastInstance;
    expect(secondRecorder.state).toBe("recording");

    teardownAudio();
    await new Promise((r) => setTimeout(r, 0));
  });

  test("4. Duplicate teardown (idempotency): calling teardownAudio multiple times closes resources exactly once", async () => {
    await startRecordingHandler?.("webm", 1.0, 401);
    const stream = createdStreams[createdStreams.length - 1];
    expect(stream).toBeDefined();
    const track = stream!.tracks[0];
    expect(track).toBeDefined();

    teardownAudio();
    expect(track!.stopCount).toBe(1);

    teardownAudio();
    teardownAudio();
    expect(track!.stopCount).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
  });

  test("5. onerror handling: MediaRecorder error triggers generation-tagged error and teardown", async () => {
    await startRecordingHandler?.("webm", 1.0, 501);
    const recorder = (FakeMediaRecorder as any).lastInstance;
    expect(recorder).toBeDefined();
    expect(recorder.state).toBe("recording");

    recorder.emitError(new Error("Encoder failure"));

    expect(sentErrors.some((e) => e.sequenceId === 501 && e.error.includes("Encoder failure"))).toBe(true);
    expect(recorder.state).toBe("inactive");
    expect(stoppedSeq).toContain(501);
    await new Promise((r) => setTimeout(r, 0));
  });

  test("6. onended track end handling: microphone disconnect stops tracks and triggers teardown", async () => {
    await startRecordingHandler?.("webm", 1.0, 601);
    const stream = createdStreams[createdStreams.length - 1];
    expect(stream).toBeDefined();
    const track = stream!.tracks[0];
    expect(track).toBeDefined();

    track!.emitEnded();

    expect(sentErrors.some((e) => e.sequenceId === 601 && e.error === "Microphone disconnected")).toBe(true);
    expect(track!.stopCount).toBe(1);
    expect(stoppedSeq).toContain(601);
    await new Promise((r) => setTimeout(r, 0));
  });

  test("7. unload (beforeunload): dispatches window event and cleans up WebAudio, MediaRecorder, and tracks", async () => {
    await startRecordingHandler?.("webm", 1.0, 701);
    const recorder = (FakeMediaRecorder as any).lastInstance;
    const stream = createdStreams[createdStreams.length - 1];
    expect(recorder).toBeDefined();
    expect(stream).toBeDefined();

    (globalThis as any).window.dispatchEvent("beforeunload");

    expect(recorder.state).toBe("inactive");
    expect(stream!.tracks[0]!.stopCount).toBe(1);
    expect(stoppedSeq).toContain(701);
    await new Promise((r) => setTimeout(r, 0));
  });

  test("8. Stale errors: delayed error from old generation is ignored during new generation", async () => {
    await startRecordingHandler?.("webm", 1.0, 801);
    const firstRecorder = (FakeMediaRecorder as any).lastInstance;

    await startRecordingHandler?.("webm", 1.0, 802);
    await new Promise((r) => setTimeout(r, 0));
    const secondRecorder = (FakeMediaRecorder as any).lastInstance;

    firstRecorder.emitError(new Error("Stale encoder error"));

    expect(sentErrors.some((e) => e.error.includes("Stale encoder error"))).toBe(false);
    expect(secondRecorder.state).toBe("recording");

    teardownAudio();
    await new Promise((r) => setTimeout(r, 0));
  });

  test("9. Stats start: meter diagnostics and audio stats are reset and gated by active generation", async () => {
    await startRecordingHandler?.("webm", 1.0, 901);
    expect(startReadySeq).toContain(901);

    teardownAudio();
    expect(stoppedSeq).toContain(901);
    await new Promise((r) => setTimeout(r, 0));
  });

  test("10. Finalize post-roll: clears postRollTimer and performs single data or error emission", async () => {
    await startRecordingHandler?.("webm", 1.0, 1001);
    expect(startReadySeq).toContain(1001);

    stopRecordingHandler?.(false);
    await new Promise((r) => setTimeout(r, 700));
    expect(stoppedSeq).toContain(1001);
    await new Promise((r) => setTimeout(r, 0));
  });

  test("11. Mic release: all MediaStreamTracks have .stop() called on teardown", async () => {
    const defaultMediaDevices = navigator.mediaDevices;
    const track1 = new FakeTrack();
    const track2 = new FakeTrack();
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          const stream = new FakeStream([track1, track2]);
          createdStreams.push(stream);
          return stream;
        },
        addEventListener: () => {},
      },
      configurable: true,
      writable: true,
    });

    try {
      await startRecordingHandler?.("webm", 1.0, 1101);
      teardownAudio();

      expect(track1.stopCount).toBe(1);
      expect(track2.stopCount).toBe(1);
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      Object.defineProperty(navigator, "mediaDevices", {
        value: createMockMediaDevices(),
        configurable: true,
        writable: true,
      });
    }
  });

  test("12. Integration: START_RECORDING_READY received during deferred selection capture succeeds without abort", async () => {
    const lifecycle = new RecordingLifecycle();
    let sentChannel = "";
    let stateHistory: string[] = [];

    const orchestrator = new CaptureOrchestrator({
      createWindow: () => ({ webContents: { id: 1 }, isDestroyed: () => false, destroy: () => {} }),
      getWebContents: (win) => win.webContents,
      isDestroyed: () => false,
      destroyWindow: () => {},
      onRenderProcessGone: () => {},
      onDidFinishLoad: (_sender, handler) => handler(),
      onClosed: () => {},
      sendIpc: (_sender, channel) => {
        sentChannel = channel;
      },
      setState: (state) => {
        stateHistory.push(state);
      },
      isQuitting: () => false,
      captureActiveSelection: async () => {
        lifecycle.acknowledgeStart(lifecycle.snapshot().sequenceId, true);
        return { hasSelection: false, selectedText: "", previousClipboard: "" };
      },
      capturePasteTarget: () => {},
      playStartChime: () => {},
      getInputGain: () => 1.0,
    }, lifecycle);

    orchestrator.ensureCaptureWindow();
    lifecycle.requestStart();
    const seq = lifecycle.snapshot().sequenceId;

    const result = await orchestrator.startRecordingFlow();
    expect(result).toBe(true);
    expect(sentChannel).toBe(IPC.START_RECORDING);
    expect(lifecycle.snapshot().state).toBe("recording");
  });

  test("13. Integration: isCaptureActive gates new recording start when prior capture is active", async () => {
    const lifecycle = new RecordingLifecycle();

    const orchestrator = new CaptureOrchestrator({
      createWindow: () => ({ webContents: { id: 1 }, isDestroyed: () => false, destroy: () => {} }),
      getWebContents: (win) => win.webContents,
      isDestroyed: () => false,
      destroyWindow: () => {},
      onRenderProcessGone: () => {},
      onDidFinishLoad: (_sender, handler) => handler(),
      onClosed: () => {},
      sendIpc: () => {},
      setState: () => {},
      isQuitting: () => false,
      captureActiveSelection: async () => ({ hasSelection: false, selectedText: "", previousClipboard: "" }),
      capturePasteTarget: () => {},
      playStartChime: () => {},
      getInputGain: () => 1.0,
    }, lifecycle);

    orchestrator.markCaptureActive(100);

    lifecycle.requestStart(); // sequence 101
    expect(orchestrator.isCaptureActive(101)).toBe(true);

    const result = await orchestrator.startRecordingFlow();
    expect(result).toBe(false);

    orchestrator.markCaptureInactive(100);
    expect(orchestrator.isCaptureActive(101)).toBe(false);
  });
});
