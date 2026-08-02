import { describe, expect, it } from "bun:test";
import {
  getPresetPromptInstructions,
  resolveEffectivePreset,
  sanitizeTranscribedText,
} from "../../services/stt";
import { defaultConfig, DEFAULT_APP_PRESET_MAPPINGS } from "../../services/config";
import manifest from "../fixtures/mixed-language-coding-eval.json";

interface FixtureItem {
  id: string;
  cohort: "english_only" | "burmese_only" | "mixed";
  text: string;
  protectedTokens: string[];
  casingCues: string[];
  expectedSanitized: {
    translationOff: string;
    translationOn: string;
  };
  description: string;
}

describe("Burmese Coding Translation Baseline (PR 1)", () => {
  describe("2. Production System Defaults & Mappings", () => {
    it("locks production configuration defaults for translation baseline", () => {
      const cfg = defaultConfig();
      expect(cfg.translateEnabled).toBe(false);
      expect(cfg.provider).toBe("gemini");
      expect(cfg.geminiModel).toBe("gemini-3.1-flash-lite");
      expect(cfg.dictationPreset).toBe("careful");
    });

    it("locks default app preset mappings for coding tools", () => {
      expect(DEFAULT_APP_PRESET_MAPPINGS.ghostty).toBe("code_comment");
      expect(DEFAULT_APP_PRESET_MAPPINGS.cursor).toBe("code_comment");
      expect(DEFAULT_APP_PRESET_MAPPINGS.zed).toBe("code_comment");
      expect(DEFAULT_APP_PRESET_MAPPINGS.code).toBe("code_comment");
    });

    it("respects custom app mapping precedence over default app mappings", () => {
      const customMappings = { ghostty: "careful" as const };
      expect(resolveEffectivePreset("auto", "ghostty", customMappings)).toBe("careful");
      expect(resolveEffectivePreset("auto", "cursor", customMappings)).toBe("code_comment");
    });
  });

  describe("3. STT Prompt Instructions", () => {
    it("returns correct instruction prompt for code_comment preset in detect mode (translateEnabled: false)", () => {
      const prompt = getPresetPromptInstructions("code_comment", false);
      expect(prompt).toContain("SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION (DETECT MODE)");
      expect(prompt).toContain("Transcribe spoken audio (Burmese or English) faithfully in its original spoken language");
      expect(prompt).toContain("Do NOT force English translation");
    });

    it("returns correct instruction prompt for code_comment preset in translation mode (translateEnabled: true)", () => {
      const prompt = getPresetPromptInstructions("code_comment", true);
      expect(prompt).toContain("SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION (TRANSLATION MODE)");
      expect(prompt).toContain("STRICT ENGLISH ONLY (ZERO BURMESE SCRIPT)");
      expect(prompt).toContain("Under NO circumstances should any Burmese script, Burmese characters");
    });
  });

  describe("4. Effective Preset Resolution for Developer Apps", () => {
    it("maps auto preset to code_comment for ghostty, cursor, zed, and code apps", () => {
      expect(resolveEffectivePreset("auto", "ghostty")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Ghostty")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "cursor")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Cursor")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "zed")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Zed")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "code")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "VS Code")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Code")).toBe("code_comment");
    });

    it("defaults auto preset to careful for non-coding apps", () => {
      expect(resolveEffectivePreset("auto", "unknown-app")).toBe("careful");
      expect(resolveEffectivePreset("auto", undefined)).toBe("careful");
    });

    it("respects explicit preset overrides regardless of active app", () => {
      expect(resolveEffectivePreset("burmese_written", "ghostty")).toBe("burmese_written");
      expect(resolveEffectivePreset("code_comment", "slack")).toBe("code_comment");
    });
  });

  describe("5. Deterministic Text Sanitization with Fixture Manifest", () => {
    const fixtures = manifest.fixtures as FixtureItem[];

    it("verifies all 3 cohorts are represented in the fixture manifest", () => {
      const cohorts = new Set(fixtures.map((f) => f.cohort));
      expect(cohorts.has("english_only")).toBe(true);
      expect(cohorts.has("burmese_only")).toBe(true);
      expect(cohorts.has("mixed")).toBe(true);
      expect(fixtures.length).toBeGreaterThanOrEqual(8);
    });

    it("preserves Burmese script when translation is OFF (translateEnabled: false)", () => {
      for (const fix of fixtures) {
        const sanitized = sanitizeTranscribedText(fix.text, "ghostty", "code_comment", [], false);
        expect(sanitized).toBe(fix.expectedSanitized.translationOff);
      }
    });

    it("preserves Burmese script losslessly in sanitizeTranscribedText when translation is ON (leaving fail-closed guard to detect residue)", () => {
      for (const fix of fixtures) {
        const sanitized = sanitizeTranscribedText(fix.text, "ghostty", "code_comment", [], true);
        // Sanitizer no longer silently purges Burmese Unicode
        expect(sanitized).toBe(fix.expectedSanitized.translationOff);
      }
    });
  });

  describe("6. Exact Preservation of Protected Technical Tokens", () => {
    const fixtures = manifest.fixtures as FixtureItem[];

    it("exact-preserves protected identifiers, commands, paths, URLs, and package names when translation is OFF", () => {
      for (const fix of fixtures) {
        const sanitized = sanitizeTranscribedText(fix.text, "ghostty", "code_comment", [], false);
        for (const token of fix.protectedTokens) {
          expect(sanitized).toContain(token);
        }
      }
    });

    it("exact-preserves protected identifiers, commands, paths, URLs, and package names when translation is ON", () => {
      for (const fix of fixtures) {
        // Skip pure Burmese fixtures where translationOn expectedSanitized is empty
        if (fix.cohort === "burmese_only" && fix.expectedSanitized.translationOn === "") {
          continue;
        }
        const sanitized = sanitizeTranscribedText(fix.text, "ghostty", "code_comment", [], true);
        for (const token of fix.protectedTokens) {
          expect(sanitized).toContain(token);
        }
      }
    });

    it("preserves technical identifier casing conventions (camelCase, snake_case, UPPERCASE)", () => {
      const input = "Check `userId` and `created_at` with API_KEY.";
      const sanitizedOff = sanitizeTranscribedText(input, "cursor", "code_comment", [], false);
      const sanitizedOn = sanitizeTranscribedText(input, "cursor", "code_comment", [], true);

      expect(sanitizedOff).toContain("userId");
      expect(sanitizedOff).toContain("created_at");
      expect(sanitizedOff).toContain("API_KEY");

      expect(sanitizedOn).toContain("userId");
      expect(sanitizedOn).toContain("created_at");
      expect(sanitizedOn).toContain("API_KEY");
    });

    it("consumes and asserts casingCues from fixture manifest for exact casing preservation", () => {
      let casingCueCount = 0;
      for (const fix of fixtures) {
        if (!fix.casingCues || fix.casingCues.length === 0) continue;
        casingCueCount += fix.casingCues.length;
        const sanitizedOff = sanitizeTranscribedText(fix.text, "ghostty", "code_comment", [], false);
        const sanitizedOn = sanitizeTranscribedText(fix.text, "ghostty", "code_comment", [], true);

        for (const cue of fix.casingCues) {
          expect(sanitizedOff).toContain(cue);
          expect(sanitizedOn).toContain(cue);
        }
      }
      expect(casingCueCount).toBeGreaterThan(0);
    });
  });
});
