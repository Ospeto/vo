import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, updateConfig } from "../../services/config.js";
import { transcribeDetailed } from "../../services/stt.js";
import { _resetGeminiClient, setGeminiClientForTests } from "../../services/gemini-client.js";

describe("VO Translation Mode State & Target Language Preservation Suite", () => {
  let tempDir: string;
  let origXdg: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-voice-trans-test-"));
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tempDir, "global-config");
    process.env.GEMINI_API_KEY = "AIzaSyTestKey_ForTranslationStateTest_12345";
    _resetGeminiClient();
  });

  afterEach(() => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    _resetGeminiClient();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("1. Target Language Preservation: Explicitly passed 'English' targetLanguage is NOT overridden by disk config", async () => {
    // Write disk config with targetLanguage: "Burmese"
    updateConfig(tempDir, { translateEnabled: true, targetLanguage: "Burmese" });

    // Mock Gemini API generateContent to inspect prompt systemInstruction
    const capturedSystemInstructions: string[] = [];
    const capturedContents: string[] = [];

    setGeminiClientForTests({
      models: {
        generateContent: async (params: any) => {
          if (params.config?.systemInstruction) {
            capturedSystemInstructions.push(params.config.systemInstruction);
          }
          const contentStr = typeof params.contents === "string"
            ? params.contents
            : JSON.stringify(params.contents || "");
          capturedContents.push(contentStr);
          return { text: "The database connection failed." };
        },
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      const res = await transcribeDetailed(dummyAudio, {
        provider: "gemini",
        translateEnabled: true,
        targetLanguage: "English", // Explicitly passed English!
        workspacePath: tempDir,
      });

      expect(res.text).toContain("The database connection failed");
      // System prompt / content must target English, NOT Burmese!
      const combinedInstructions = capturedSystemInstructions.join(" ") + " " + capturedContents.join(" ");
      expect(combinedInstructions).toContain("English");
      expect(combinedInstructions).not.toContain("translation into Burmese");
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("2. Intentional Target Language: Explicitly passed 'Burmese' targetLanguage works when requested", async () => {
    updateConfig(tempDir, { translateEnabled: true, targetLanguage: "English" });

    let capturedSystemInstruction = "";

    setGeminiClientForTests({
      models: {
        generateContent: async (params: any) => {
          capturedSystemInstruction = params.config?.systemInstruction || "";
          return { text: "ဒေတာဘေ့စ် ချိတ်ဆက်မှု မအောင်မြင်ပါ။" };
        },
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      await transcribeDetailed(dummyAudio, {
        provider: "gemini",
        translateEnabled: true,
        targetLanguage: "Burmese",
        workspacePath: tempDir,
      });

      expect(capturedSystemInstruction).toContain("translation into Burmese");
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("3. Detect Mode Preservation: When translateEnabled is false, ordinary detect mode runs without forcing translation", async () => {
    updateConfig(tempDir, { translateEnabled: false, targetLanguage: "English" });

    let capturedSystemInstruction = "";
    let capturedUserPrompt = "";

    setGeminiClientForTests({
      models: {
        generateContent: async (params: any) => {
          capturedSystemInstruction = params.config?.systemInstruction || "";
          capturedUserPrompt = params.contents?.[0]?.parts?.[1]?.text || "";
          return { text: "Database connection ကို test လုပ်ပါ။" };
        },
      },
    });

    try {
      const dummyAudio = new Uint8Array(2000).buffer;
      const res = await transcribeDetailed(dummyAudio, {
        provider: "gemini",
        translateEnabled: false,
        targetLanguage: "English",
        workspacePath: tempDir,
      });

      expect(res.text).toContain("Database connection ကို test လုပ်ပါ");
      // System prompt should use standard STT prompt, not forced translation!
      expect(capturedSystemInstruction).toContain("high-precision Burmese & English Speech-to-Text transcriber");
      expect(capturedUserPrompt).toContain("Transcribe the spoken audio accurately in its original spoken language");
    } finally {
      setGeminiClientForTests(null);
    }
  });

  test("4. Legacy Config Migration: Migrates legacy 'translate' preset to 'careful' preset + translateEnabled: true", () => {
    const configDir = join(tempDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "pi-voice.json");

    // Inject legacy config format into json file
    const legacyContent = {
      dictationPreset: "translate",
      targetLanguage: "Japanese",
    };
    writeFileSync(configPath, JSON.stringify(legacyContent, null, 2), "utf-8");

    const loaded = loadConfig(tempDir);
    expect(loaded.dictationPreset).toBe("careful");
    expect(loaded.translateEnabled).toBe(true);
    expect(loaded.targetLanguage).toBe("Japanese");
  });

  test("5. Persistence across mode updates: Preserves targetLanguage choice when updating preset or gain", () => {
    const cfg1 = updateConfig(tempDir, { translateEnabled: true, targetLanguage: "French" });
    expect(cfg1.targetLanguage).toBe("French");
    expect(cfg1.translateEnabled).toBe(true);

    const cfg2 = updateConfig(tempDir, { dictationPreset: "code_comment", inputGain: 1.5 });
    expect(cfg2.targetLanguage).toBe("French");
    expect(cfg2.translateEnabled).toBe(true);
    expect(cfg2.dictationPreset).toBe("code_comment");
    expect(cfg2.inputGain).toBe(1.5);
  });

  test("6. Persistence migration: Updating a legacy translate config keeps translation enabled", () => {
    const configDir = join(tempDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "pi-voice.json"),
      JSON.stringify({ dictationPreset: "translate", targetLanguage: "Japanese" }),
      "utf-8",
    );

    const updated = updateConfig(tempDir, { inputGain: 1.5 });

    expect(updated.dictationPreset).toBe("careful");
    expect(updated.translateEnabled).toBe(true);
    expect(updated.targetLanguage).toBe("Japanese");
  });

  test("7. Cancellation & Abort Safety: Aborted STT request fails fast and does not process response", async () => {
    const controller = new AbortController();
    controller.abort();

    const dummyAudio = new Uint8Array(2000).buffer;
    expect(
      transcribeDetailed(dummyAudio, {
        provider: "gemini",
        translateEnabled: true,
        targetLanguage: "English",
        abortSignal: controller.signal,
        workspacePath: tempDir,
      })
    ).rejects.toThrow("Transcription aborted");
  });
});
