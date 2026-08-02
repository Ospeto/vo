import { describe, test, expect, mock } from "bun:test";
import { transcribeDetailed } from "../../services/stt.js";
import { setGeminiClientForTests, _resetGeminiClient } from "../../services/gemini-client.js";

describe("P1 Two-Step Production Wiring & Integration Suite", () => {
  test("transcribeDetailed routes translation-enabled dictation through Stage 1 STT and Stage 2 Text Translation", async () => {
    _resetGeminiClient();
    const calls: Array<{ model: string; content: any }> = [];

    setGeminiClientForTests({
      models: {
        generateContent: async (params: any) => {
          calls.push({ model: params.model, content: params.contents });
          if (calls.length === 1) {
            // Stage 1 Audio STT
            return { text: "Check `userId` ကို စစ်ဆေးပါ" };
          } else {
            // Stage 2 Text Translation
            return { text: "Check `userId` and verify" };
          }
        },
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      const res = await transcribeDetailed(dummyAudio, {
        provider: "gemini",
        geminiModel: "gemini-3.1-flash-lite",
        translateEnabled: true,
        targetLanguage: "English",
        dictationPreset: "code_comment",
        activeApp: "VS Code",
      });

      expect(res.text).toBe("Check `userId` and verify");
      expect(calls.length).toBe(2);
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("fails closed when Stage 2 translation drops technical tokens", async () => {
    _resetGeminiClient();
    let callCount = 0;

    setGeminiClientForTests({
      models: {
        generateContent: async () => {
          callCount++;
          if (callCount === 1) {
            // Stage 1 Audio STT contains technical token `userId` and `created_at`
            return { text: "Check `userId` and `created_at` ကို စစ်ဆေးပါ" };
          } else {
            // Stage 2 Text Translation accidentally drops `created_at`
            return { text: "Check `userId` and verify" };
          }
        },
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      expect(
        transcribeDetailed(dummyAudio, {
          provider: "gemini",
          translateEnabled: true,
          targetLanguage: "English",
        })
      ).rejects.toThrow("Translation dropped required technical tokens: created_at");
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("aborts two-step translation cleanly when AbortSignal triggers", async () => {
    _resetGeminiClient();
    const controller = new AbortController();

    setGeminiClientForTests({
      models: {
        generateContent: async () => {
          controller.abort();
          return { text: "Check `userId` ကို စစ်ဆေးပါ" };
        },
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      expect(
        transcribeDetailed(dummyAudio, {
          provider: "gemini",
          translateEnabled: true,
          targetLanguage: "English",
          abortSignal: controller.signal,
        })
      ).rejects.toThrow("Transcription cancelled");
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("bypasses two-step translation path when translateEnabled is false", async () => {
    _resetGeminiClient();
    let callCount = 0;

    setGeminiClientForTests({
      models: {
        generateContent: async () => {
          callCount++;
          return { text: "Check `userId` ကို စစ်ဆေးပါ" };
        },
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      const res = await transcribeDetailed(dummyAudio, {
        provider: "gemini",
        translateEnabled: false,
        targetLanguage: "English",
      });

      expect(res.text).toBe("Check `userId` ကို စစ်ဆေးပါ");
      expect(callCount).toBe(1);
    } finally {
      setGeminiClientForTests(null);
    }
  });
});
