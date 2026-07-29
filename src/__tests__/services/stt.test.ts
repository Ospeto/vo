import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock logger
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Mock gemini-client
const mockGenerateContent = mock(async () => ({
  text: "gemini transcription",
}));
let mockFallbackGenerateContent: any = null;
const mockGeminiClient = {
  models: {
    generateContent: mockGenerateContent,
  },
};
const mockGeminiFallbackClient = {
  models: {
    generateContent: (...args: any[]) => mockFallbackGenerateContent?.(...args),
  },
};

mock.module("../../services/gemini-client.js", () => ({
  getGeminiClient: () => mockGeminiClient,
  getGeminiFallbackClient: () => (mockFallbackGenerateContent ? mockGeminiFallbackClient : null),
  isFallbackClient: (client: unknown) => client === mockGeminiFallbackClient,
  _resetGeminiClient: () => {},
}));

// Mock OpenAI
const mockOpenAITranscription = mock(async () => ({
  text: "openai transcription",
}));
mock.module("openai", () => {
  return {
    default: class OpenAI {
      audio = {
        transcriptions: {
          create: mockOpenAITranscription,
        },
      };
    },
    toFile: mock(async (buf: any, name: string) => ({ name, data: buf })),
  };
});

// Mock ElevenLabs
const mockElevenLabsSTT = mock(async () => ({
  text: "elevenlabs transcription",
}));
mock.module("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: class {
    speechToText = {
      convert: mockElevenLabsSTT,
    };
  },
}));

// Mock Whisper
const mockWhisperFull = mock(async () => "whisper transcription");
mock.module("@napi-rs/whisper", () => ({
  Whisper: class {
    full = mockWhisperFull;
  },
  WhisperFullParams: class {
    language = "auto";
    printProgress = false;
    printRealtime = false;
    printTimestamps = false;
    singleSegment = false;
    noTimestamps = true;
  },
  WhisperSamplingStrategy: { Greedy: 0 },
}));

// Mock whisper-model
mock.module("../../services/whisper-model.js", () => ({
  resolveModelPath: async () => "/fake/model.bin",
}));

const { transcribe } = await import("../../services/stt.js");

describe("transcribe", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    };
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";

    mockGenerateContent.mockClear();
    mockOpenAITranscription.mockClear();
    mockElevenLabsSTT.mockClear();
    mockWhisperFull.mockClear();
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test("transcribes with gemini provider", async () => {
    const data = new ArrayBuffer(100);
    const result = await transcribe(data, "gemini");
    expect(result).toBe("Gemini transcription");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test("aborts a paid fallback when the model timeout wins", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    let fallbackSignal: AbortSignal | undefined;
    mockGenerateContent.mockImplementation(async () => new Promise(() => {}));
    mockFallbackGenerateContent = mock(async (request: any) => {
      fallbackSignal = request.config.abortSignal;
      await new Promise((_, reject) => {
        fallbackSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return { text: "unreachable" };
    });
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: any[]) =>
      originalSetTimeout(callback, delay === 2000 ? 1 : delay && delay > 2000 ? 10 : delay, ...args)) as typeof setTimeout;

    try {
      await expect(transcribe(new ArrayBuffer(10), "gemini")).rejects.toThrow("All Gemini STT models failed");
      expect(fallbackSignal?.aborted).toBe(true);
      expect(mockFallbackGenerateContent).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      mockFallbackGenerateContent = null;
      mockGenerateContent.mockImplementation(async () => ({ text: "gemini transcription" }));
    }
  });

  test("transcribes with openai provider", async () => {
    const data = new ArrayBuffer(100);
    const result = await transcribe(data, "openai");
    expect(result).toBe("Openai transcription");
    expect(mockOpenAITranscription).toHaveBeenCalledTimes(1);
  });

  test("transcribes with elevenlabs provider", async () => {
    const data = new ArrayBuffer(100);
    const result = await transcribe(data, "elevenlabs");
    expect(result).toBe("Elevenlabs transcription");
    expect(mockElevenLabsSTT).toHaveBeenCalledTimes(1);
  });

  test("transcribes with local provider", async () => {
    // local expects Float32Array PCM data
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    const result = await transcribe(samples.buffer as ArrayBuffer, "local");
    expect(result).toBe("Whisper transcription");
    expect(mockWhisperFull).toHaveBeenCalledTimes(1);
  });

  test("defaults to gemini provider when not specified", async () => {
    const samples = new Float32Array([0.1, 0.2]);
    const result = await transcribe(samples.buffer as ArrayBuffer);
    expect(result).toBe("Gemini transcription");
  });

  test("gemini provider sends base64 audio data", async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    await transcribe(data, "gemini");

    const calls = mockGenerateContent.mock.calls as any[];
    const content = calls[0]![0].contents[0].parts;
    // Should have inlineData and text parts
    expect(content.length).toBe(2);
    expect(content[0].inlineData.mimeType).toBe("audio/webm");
    expect(typeof content[0].inlineData.data).toBe("string"); // base64
  });

  test("returns empty string from gemini when text is null", async () => {
    mockGenerateContent.mockImplementation(async () => ({
      text: null as any,
    }));

    const data = new ArrayBuffer(10);
    const result = await transcribe(data, "gemini");
    expect(result).toBe("");

    // Restore
    mockGenerateContent.mockImplementation(async () => ({
      text: "gemini transcription",
    }));
  });

  test("trims whitespace from transcription", async () => {
    mockGenerateContent.mockImplementation(async () => ({
      text: "  hello world  ",
    }));

    const data = new ArrayBuffer(10);
    const result = await transcribe(data, "gemini");
    expect(result).toBe("Hello world");

    // Restore
    mockGenerateContent.mockImplementation(async () => ({
      text: "gemini transcription",
    }));
  });

  test("converts spoken bullet point phrases to bulleted lists", async () => {
    const { sanitizeTranscribedText } = await import("../../services/stt.js");
    const result = sanitizeTranscribedText("bullet point First item");
    expect(result).toBe("- First item");
  });

  test("preserves Burmese script for code_comment preset when translate toggle is off", async () => {
    const { sanitizeTranscribedText } = await import("../../services/stt.js");
    const input = "Review and refactor code, ensuring error handling branches are consolidated ပြန်တော့ review လုပ်ရဦးမလားလို့";
    const result = sanitizeTranscribedText(input, "VS Code", "code_comment");
    expect(result).toContain("ပြန်တော့ review လုပ်ရဦးမလားလို့");
  });

  test("preserves Burmese script when preset is auto and activeApp is VS Code and translate toggle is off", async () => {
    const { sanitizeTranscribedText } = await import("../../services/stt.js");
    const input = "Review and refactor code, ensuring error handling branches are consolidated ပြန်တော့ review လုပ်ရဦးမလားလို့";
    const result = sanitizeTranscribedText(input, "VS Code", "auto");
    expect(result).toContain("ပြန်တော့ review လုပ်ရဦးမလားလို့");
  });

  test("strips Burmese and English hesitation fillers (nd-sat, like, you know, ဟိုဟာလေ)", async () => {
    const { sanitizeTranscribedText } = await import("../../services/stt.js");
    expect(sanitizeTranscribedText("hello world, nd-sat")).toBe("Hello world");
    expect(sanitizeTranscribedText("like, fix the issue, you know, completely")).toBe("Fix the issue, completely");
    expect(sanitizeTranscribedText("ဟိုဟာလေ Database connection ကို test လုပ်ပေး")).toBe("Database connection ကို test လုပ်ပေး");
  });

  test("purges standalone hesitation sounds (အာ..., ဟာ, အင်း) while preserving valid Burmese words (အကြောင်း, အဆင်ပြေ)", async () => {
    const { sanitizeTranscribedText } = await import("../../services/stt.js");
    expect(sanitizeTranscribedText("အာ... Database connection အကြောင်း အဆင်ပြေအောင် လုပ်ပေး")).toBe("Database connection အကြောင်း အဆင်ပြေအောင် လုပ်ပေး");
    expect(sanitizeTranscribedText("ဟာ... အလုပ် အဆင်ပြေလား အင်း")).toBe("အလုပ် အဆင်ပြေလား");
  });

  test("returns careful proofreading prompt instructions and includes 3.6-flash in fallback chain", async () => {
    const { getPresetPromptInstructions, getFallbackModelChain } = await import("../../services/stt.js");
    const instructions = getPresetPromptInstructions("careful");
    expect(instructions).toContain("CAREFUL DEEP PROOFREADING");
    
    const fallbackChain = getFallbackModelChain("gemini-3.1-flash-lite", "careful");
    expect(fallbackChain).not.toContain("gemini-3.6-flash");
    expect(fallbackChain[0]).toBe("gemini-3.1-flash-lite");
  });

  test("resolves custom appPresetMappings in resolveEffectivePreset", async () => {
    const { resolveEffectivePreset } = await import("../../services/stt.js");
    const customMappings = { xcode: "code_comment" as const, discord: "email_polish" as const };
    
    expect(resolveEffectivePreset("auto", "Xcode", customMappings)).toBe("code_comment");
    expect(resolveEffectivePreset("auto", "Discord", customMappings)).toBe("email_polish");
    expect(resolveEffectivePreset("auto", "UnknownApp", customMappings)).toBe("careful");
  });

  test("uses fallback client when primary gemini key rejects fast and sets usedPaidKey to true", async () => {
    const { transcribeDetailed } = await import("../../services/stt.js");
    mockGenerateContent.mockImplementationOnce(async () => {
      throw new Error("429 Rate Limit");
    });
    mockFallbackGenerateContent = mock(async () => ({
      text: "paid fallback transcription",
    }));

    const data = new ArrayBuffer(10);
    const result = await transcribeDetailed(data, "gemini");
    expect(result.text).toBe("Paid fallback transcription");
    expect(result.usedPaidKey).toBe(true);
    expect(mockFallbackGenerateContent).toHaveBeenCalledTimes(1);

    mockFallbackGenerateContent = null;
  });

  test("returns usedPaidKey true for openai and elevenlabs providers", async () => {
    const { transcribeDetailed } = await import("../../services/stt.js");
    const data = new ArrayBuffer(10);

    const openaiRes = await transcribeDetailed(data, "openai");
    expect(openaiRes.usedPaidKey).toBe(true);

    const elevenRes = await transcribeDetailed(data, "elevenlabs");
    expect(elevenRes.usedPaidKey).toBe(true);
  });

  test("does not invoke fallback client when primary gemini key succeeds fast", async () => {
    mockGenerateContent.mockImplementationOnce(async () => ({
      text: "primary fast result",
    }));
    mockFallbackGenerateContent = mock(async () => ({
      text: "paid fallback transcription",
    }));

    const data = new ArrayBuffer(10);
    const result = await transcribe(data, "gemini");
    expect(result).toBe("Primary fast result");
    expect(mockFallbackGenerateContent).toHaveBeenCalledTimes(0);

    mockFallbackGenerateContent = null;
  });

  describe("Editing mode & Translation Fallback Ownership Boundaries", () => {
    test("preserves Burmese translation output during editing mode without executing English text translation fallback", async () => {
      const { transcribeDetailed } = await import("../../services/stt.js");
      mockGenerateContent.mockImplementationOnce(async () => ({
        text: "မင်္ဂလာပါ ကမ္ဘာလောက",
      }));

      const data = new ArrayBuffer(10);
      const res = await transcribeDetailed(data, {
        provider: "gemini",
        dictationPreset: "code_comment",
        translateEnabled: false,
        selectedText: "Hello world",
      });

      expect(res.text).toBe("မင်္ဂလာပါ ကမ္ဘာလောက");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    test("preserves Burmese dictation in code preset when translation is not enabled", async () => {
      const { transcribeDetailed } = await import("../../services/stt.js");
      mockGenerateContent.mockImplementationOnce(async () => ({
        text: "ဒီ function ကို refactor လုပ်မယ်",
      }));

      const data = new ArrayBuffer(10);
      const res = await transcribeDetailed(data, {
        provider: "gemini",
        dictationPreset: "code_comment",
        translateEnabled: false,
      });

      expect(res.text).toBe("ဒီ function ကို refactor လုပ်မယ်");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    test("executes English text translation fallback in non-editing code preset when translation is enabled and Burmese text returned", async () => {
      const { transcribeDetailed } = await import("../../services/stt.js");
      mockGenerateContent
        .mockImplementationOnce(async () => ({
          text: "ဒီ function ကို refactor လုပ်မယ်",
        }))
        .mockImplementationOnce(async () => ({
          text: "Refactor this function",
        }));

      const data = new ArrayBuffer(10);
      const res = await transcribeDetailed(data, {
        provider: "gemini",
        dictationPreset: "code_comment",
        translateEnabled: true,
      });

      expect(res.text).toBe("Refactor this function");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    test("skips secondary text translation fallback when abortSignal is aborted", async () => {
      const { transcribeDetailed } = await import("../../services/stt.js");
      const controller = new AbortController();
      mockGenerateContent.mockImplementationOnce(async () => {
        controller.abort();
        return { text: "မင်္ဂလာပါ" };
      });

      const data = new ArrayBuffer(10);
      const res = await transcribeDetailed(data, {
        provider: "gemini",
        dictationPreset: "code_comment",
        translateEnabled: true,
        abortSignal: controller.signal,
      });

      expect(res.text).toBe("မင်္ဂလာပါ");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});
