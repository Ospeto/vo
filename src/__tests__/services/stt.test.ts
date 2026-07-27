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
mock.module("../../services/gemini-client.js", () => ({
  getGeminiClient: () => ({
    models: {
      generateContent: mockGenerateContent,
    },
  }),
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

  test("purges trailing and inline Burmese script for code_comment preset", async () => {
    const { sanitizeTranscribedText } = await import("../../services/stt.js");
    const input = "Review and refactor the Diablo integration code, ensuring all duplicate error handling branches are consolidatedဆင် တော့ ထင်တာပဲ ဒါပေမဲ့ နှစ်ထပ်နှစ်ထပ်တော့ ဖြစ်နေသလိုပဲ နည်းနည်း ပြန်တော့ review လုပ်ရဦးမလားလို့";
    const result = sanitizeTranscribedText(input, "VS Code", "code_comment");
    expect(result).toBe("Review and refactor the Diablo integration code, ensuring all duplicate error handling branches are consolidated review");
    expect(/[\u1000-\u109F]/.test(result)).toBe(false);
  });

  test("purges trailing and inline Burmese script when preset is auto and activeApp is VS Code", async () => {
    const { sanitizeTranscribedText } = await import("../../services/stt.js");
    const input = "Review and refactor the Diablo integration code, ensuring all duplicate error handling branches are consolidatedဆင် တော့ ထင်တာပဲ ဒါပေမဲ့ နှစ်ထပ်နှစ်ထပ်တော့ ဖြစ်နေသလိုပဲ နည်းနည်း ပြန်တော့ review လုပ်ရဦးမလားလို့";
    const result = sanitizeTranscribedText(input, "VS Code", "auto");
    expect(result).toBe("Review and refactor the Diablo integration code, ensuring all duplicate error handling branches are consolidated review");
    expect(/[\u1000-\u109F]/.test(result)).toBe(false);
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
});
