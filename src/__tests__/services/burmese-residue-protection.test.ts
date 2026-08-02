import { describe, test, expect, mock } from "bun:test";
import { BURMESE_UNICODE_REGEX, sanitizeTranscribedText, transcribeDetailed } from "../../services/stt.js";
import { setGeminiClientForTests, _resetGeminiClient } from "../../services/gemini-client.js";

describe("P0 Burmese-Residue Fail-Closed Protection Suite", () => {
  test("BURMESE_UNICODE_REGEX detects Burmese script characters", () => {
    expect(BURMESE_UNICODE_REGEX.test("Check userId ကို စစ်ဆေးပါ")).toBe(true);
    expect(BURMESE_UNICODE_REGEX.test("Check userId and update created_at")).toBe(false);
    expect(BURMESE_UNICODE_REGEX.test("ကုဒ်စစ်ဆေးပါ။")).toBe(true);
    expect(BURMESE_UNICODE_REGEX.test("git status")).toBe(false);
  });

  test("sanitizeTranscribedText preserves Burmese Unicode characters losslessly in translation mode", () => {
    const input = "Check `userId` ကို စစ်ဆေးပါ";
    const sanitized = sanitizeTranscribedText(input, "VS Code", "code_comment", [], true, "English");

    expect(sanitized).toBe(input);
    expect(BURMESE_UNICODE_REGEX.test(sanitized)).toBe(true);
  });

  test("transcribeDetailed throws translation incomplete error when Burmese script remains in output during translation mode", async () => {
    _resetGeminiClient();
    setGeminiClientForTests({
      models: {
        generateContent: async () => ({
          text: "Check `userId` ကို စစ်ဆေးပါ",
        }),
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
      ).rejects.toThrow("Translation incomplete: Burmese script remained in transcript");
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("transcribeDetailed passes clean English transcript without throwing in translation mode", async () => {
    _resetGeminiClient();
    setGeminiClientForTests({
      models: {
        generateContent: async () => ({
          text: "Check `userId` and verify permissions",
        }),
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      const res = await transcribeDetailed(dummyAudio, {
        provider: "gemini",
        translateEnabled: true,
        targetLanguage: "English",
      });

      expect(res.text).toBe("Check `userId` and verify permissions");
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("transcribeDetailed preserves Burmese script when targetLanguage is Burmese", async () => {
    _resetGeminiClient();
    setGeminiClientForTests({
      models: {
        generateContent: async () => ({
          text: "Check `userId` ကို စစ်ဆေးပါ",
        }),
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      const res = await transcribeDetailed(dummyAudio, {
        provider: "gemini",
        translateEnabled: true,
        targetLanguage: "Burmese",
      });

      expect(res.text).toBe("Check `userId` ကို စစ်ဆေးပါ");
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("transcribeDetailed preserves Burmese script when translateEnabled is false (dictation mode)", async () => {
    _resetGeminiClient();
    setGeminiClientForTests({
      models: {
        generateContent: async () => ({
          text: "Check `userId` ကို စစ်ဆေးပါ",
        }),
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
    } finally {
      setGeminiClientForTests(null);
    }
  });
});
