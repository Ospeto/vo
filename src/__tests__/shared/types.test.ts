import { describe, test, expect } from "bun:test";
import { IPC } from "../../shared/types.js";
import type { PiVoiceConfigPatch } from "../../services/config.js";

describe("IPC constants", () => {
  test("contains all expected channel names", () => {
    expect(IPC.START_RECORDING).toBe("start-recording");
    expect(IPC.STOP_RECORDING).toBe("stop-recording");
    expect(IPC.PLAY_AUDIO_STREAM_START).toBe("play-audio-stream-start");
    expect(IPC.PLAY_AUDIO_STREAM_CHUNK).toBe("play-audio-stream-chunk");
    expect(IPC.PLAY_AUDIO_STREAM_END).toBe("play-audio-stream-end");
    expect(IPC.RECORDING_DATA).toBe("recording-data");
    expect(IPC.RECORDING_ERROR).toBe("recording-error");
    expect(IPC.PLAYBACK_DONE).toBe("playback-done");
  });

  test("all values are unique strings", () => {
    const values = Object.values(IPC);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe("string");
    }
  });
});

describe("PiVoiceConfigPatch type coverage", () => {
  test("allows all patch fields without type errors", () => {
    const patch: PiVoiceConfigPatch = {
      geminiApiKey: "key1,key2",
      geminiFallbackApiKey: "key_fb",
      customVocabulary: ["word1"],
      presetVocabulary: { careful: ["word2"] },
      appPresetMappings: { vscode: "code_comment" },
      translateEnabled: true,
      targetLanguage: "English",
      chimeSoundStart: "glass",
      chimeSoundEnd: "submarine",
      symbolScannerEnabled: false,
      audioDeviceId: "default",
    };
    expect(patch.geminiApiKey).toBe("key1,key2");
    expect(patch.symbolScannerEnabled).toBe(false);
  });
});
