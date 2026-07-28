import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, updateConfig } from "../../services/config.js";
import { resolveEffectivePreset, getPresetPromptInstructions, transcribeDetailed } from "../../services/stt.js";
import { _resetGeminiClient } from "../../services/gemini-client.js";

describe("VO Language Stability & Mode Separation Suite (Round 4)", () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-voice-lang-stability-"));
    process.env.GEMINI_API_KEY = "test-gemini-key";
    _resetGeminiClient();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetGeminiClient();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("1. Explicit Language & Dictation Preset Persistence", () => {
    test("preserves explicit dictation preset without overriding with auto-detection", () => {
      expect(resolveEffectivePreset("burmese_written", "Cursor")).toBe("burmese_written");
      expect(resolveEffectivePreset("code_comment", "Obsidian")).toBe("code_comment");
      expect(resolveEffectivePreset("email_polish", "Terminal")).toBe("email_polish");
      expect(resolveEffectivePreset("careful", "Slack")).toBe("careful");
      expect(resolveEffectivePreset("fast", "VS Code")).toBe("fast");
    });

    test("auto preset dynamically resolves preset based on active window and app mappings", () => {
      expect(resolveEffectivePreset("auto", "Cursor")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Terminal")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Obsidian")).toBe("burmese_written");
      expect(resolveEffectivePreset("auto", "Slack")).toBe("email_polish");
      expect(resolveEffectivePreset("auto", "Calculator")).toBe("careful");

      const customMappings = { calculator: "code_comment" as const };
      expect(resolveEffectivePreset("auto", "Calculator", customMappings)).toBe("code_comment");
    });

    test("persists explicit dictationPreset, translateEnabled, and targetLanguage losslessly across updates and restarts", () => {
      const cfg1 = updateConfig(tempDir, {
        dictationPreset: "burmese_written",
        translateEnabled: true,
        targetLanguage: "Japanese",
      });
      expect(cfg1.dictationPreset).toBe("burmese_written");
      expect(cfg1.translateEnabled).toBe(true);
      expect(cfg1.targetLanguage).toBe("Japanese");

      // Reload config from disk
      const loaded = loadConfig(tempDir);
      expect(loaded.dictationPreset).toBe("burmese_written");
      expect(loaded.translateEnabled).toBe(true);
      expect(loaded.targetLanguage).toBe("Japanese");

      // Update unrelated field (inputGain) and ensure language settings persist
      const cfg2 = updateConfig(tempDir, { inputGain: 1.5 });
      expect(cfg2.dictationPreset).toBe("burmese_written");
      expect(cfg2.translateEnabled).toBe(true);
      expect(cfg2.targetLanguage).toBe("Japanese");
      expect(cfg2.inputGain).toBe(1.5);
    });

    test("migrates legacy 'translate' preset to 'careful' preset + translateEnabled: true without losing targetLanguage", () => {
      const legacyJson = JSON.stringify({
        dictationPreset: "translate",
        targetLanguage: "French",
      });
      mkdirSync(join(tempDir, ".pi"), { recursive: true });
      writeFileSync(join(tempDir, ".pi", "pi-voice.json"), legacyJson);

      const loaded = loadConfig(tempDir);
      expect(loaded.dictationPreset).toBe("careful");
      expect(loaded.translateEnabled).toBe(true);
      expect(loaded.targetLanguage).toBe("French");
    });
  });

  describe("2. Strict Mode Separation (Detect Mode vs Translation Mode)", () => {
    test("provides tailored prompt instructions for all dictation presets", () => {
      const burmeseInstructions = getPresetPromptInstructions("burmese_written");
      expect(burmeseInstructions).toContain("BURMESE WRITTEN PROSE");

      const emailInstructions = getPresetPromptInstructions("email_polish");
      expect(emailInstructions).toContain("EMAIL & MESSAGE POLISHING");

      const codeInstructions = getPresetPromptInstructions("code_comment");
      expect(codeInstructions).toContain("SYSTEMATIC CODE DICTATION");

      const carefulInstructions = getPresetPromptInstructions("careful");
      expect(carefulInstructions).toContain("CAREFUL DEEP PROOFREADING");
    });

    test("explicit translateEnabled: false disables translation mode even when targetLanguage is set", async () => {
      updateConfig(tempDir, { translateEnabled: false, targetLanguage: "Japanese" });

      let capturedSystemInstruction = "";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        capturedSystemInstruction = body.systemInstruction?.parts?.[0]?.text || "";
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "The database is ready." }] } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as any;

      try {
        const res = await transcribeDetailed(new Float32Array(16000).buffer, {
          provider: "gemini",
          dictationPreset: "burmese_written",
          translateEnabled: false,
          targetLanguage: "Japanese",
          workspacePath: tempDir,
        });

        expect(res.text).toBe("The database is ready");
        expect(capturedSystemInstruction).toContain("original spoken language");
        expect(capturedSystemInstruction).not.toContain("into fluent, natural Burmese written prose");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("3. Separation of Transcription Language and Translation Target Language", () => {
    test("explicitly passed targetLanguage is preserved and separated from dictation language", () => {
      const cfg = updateConfig(tempDir, {
        dictationPreset: "burmese_written",
        translateEnabled: true,
        targetLanguage: "German",
      });

      expect(cfg.dictationPreset).toBe("burmese_written");
      expect(cfg.targetLanguage).toBe("German");
      expect(cfg.translateEnabled).toBe(true);
    });

    test("changing targetLanguage does not alter active dictationPreset", () => {
      updateConfig(tempDir, { dictationPreset: "code_comment", translateEnabled: false, targetLanguage: "English" });
      const updated = updateConfig(tempDir, { targetLanguage: "Spanish" });

      expect(updated.dictationPreset).toBe("code_comment");
      expect(updated.translateEnabled).toBe(false);
      expect(updated.targetLanguage).toBe("Spanish");
    });
  });

  describe("4. Cancellation & Stale Response Protection", () => {
    test("aborted STT signal rejects request immediately before API execution", async () => {
      const controller = new AbortController();
      controller.abort();

      const fakeAudio = new Float32Array(16000).buffer;
      expect(
        transcribeDetailed(fakeAudio, {
          provider: "gemini",
          abortSignal: controller.signal,
        })
      ).rejects.toThrow("Transcription aborted");
    });
  });
});
