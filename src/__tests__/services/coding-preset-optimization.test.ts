import { describe, test, expect } from "bun:test";
import {
  getPresetPromptInstructions,
  sanitizeTranscribedText,
  sanitizeCodePresetText,
  resolveEffectivePreset,
} from "../../services/stt.js";
import { getCommentSyntaxForFile } from "../../services/two-step-translation.js";

describe("Coding Preset Optimization & Vibe Coding Suite (code_comment)", () => {
  describe("1. Detect Mode (translateEnabled: false)", () => {
    test("getPresetPromptInstructions returns faithful detect mode prompt preserving original language and identifier casing", () => {
      const instructions = getPresetPromptInstructions("code_comment", false);

      expect(instructions).toContain("SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION (DETECT MODE)");
      expect(instructions).toContain("Transcribe spoken audio (Burmese or English) faithfully in its original spoken language");
      expect(instructions).toContain("Do NOT force English translation");
      expect(instructions).toContain('"camel case user id" -> userId');
      expect(instructions).toContain('"snake case created at" -> created_at');
      expect(instructions).toContain('"pascal case user response" -> UserResponse');
      expect(instructions).toContain('"upper case api key" -> API_KEY');
      expect(instructions).toContain('"kebab case user-card" -> user-card');
      expect(instructions).toContain("ZERO CONVERSATIONAL PREAMBLES & ZERO BOILERPLATE");
    });

    test("sanitizeTranscribedText preserves Burmese script losslessly when translateEnabled is false", () => {
      const input = "Review and refactor code, ensuring error handling branches are consolidated ပြန်တော့ review လုပ်ရဦးမလားလို့";
      const result = sanitizeTranscribedText(input, "VS Code", "code_comment", undefined, false);

      expect(result).toContain("ပြန်တော့ review လုပ်ရဦးမလားလို့");
      expect(result).toContain("Review and refactor code");
    });

    test("sanitizeTranscribedText preserves Burmese vibe coding dictation for auto preset in coding target apps when translateEnabled is false", () => {
      const effective = resolveEffectivePreset("auto", "Cursor");
      expect(effective).toBe("code_comment");

      const input = "Add camel case user id check ဒီ function ကို refactor လုပ်မယ်";
      const result = sanitizeTranscribedText(input, "Cursor", "auto", undefined, false);

      expect(result).toBe("Add camel case user id check ဒီ function ကို refactor လုပ်မယ်");
    });
  });

  describe("2. Translation Mode (translateEnabled: true)", () => {
    test("getPresetPromptInstructions returns English technical specification prompt optimized for AI coding assistants", () => {
      const instructions = getPresetPromptInstructions("code_comment", true);

      expect(instructions).toContain("SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION (TRANSLATION MODE)");
      expect(instructions).toContain("Translate the developer's spoken Burmese/English dictation directly into clean, precise, professional English technical specifications");
      expect(instructions).toContain("Cursor / Antigravity / Claude / Copilot");
      expect(instructions).toContain("FAITHFUL TRANSLATION & ZERO IMPROVISATION");
      expect(instructions).toContain('"pascal case user response" -> UserResponse');
      expect(instructions).toContain("STRICT ENGLISH ONLY (ZERO BURMESE SCRIPT)");
      expect(instructions).toContain("ZERO BOILERPLATE & ZERO PREAMBLES");
    });

    test("sanitizeTranscribedText preserves Burmese script losslessly when translateEnabled is true so fail-closed guard can inspect residue", () => {
      const input = "Return early if userId is null or undefined\nပြန်တော့လုပ်ရဦးမလားလို့";
      const result = sanitizeTranscribedText(input, "VS Code", "code_comment", undefined, true);

      expect(result).toBe("Return early if userId is null or undefined\nပြန်တော့လုပ်ရဦးမလားလို့");
      expect(result).toContain("ပြန်တော့");
    });

    test("sanitizeTranscribedText preserves residual Burmese characters on mixed lines when translateEnabled is true", () => {
      const input = "Refactor this function to handle errors gracefully ပြန်ကြည့်ပေးပါ";
      const result = sanitizeTranscribedText(input, "Cursor", "code_comment", undefined, true);

      expect(result).toBe("Refactor this function to handle errors gracefully ပြန်ကြည့်ပေးပါ");
      expect(result).toContain("ပြန်ကြည့်ပေးပါ");
    });

    test("sanitizeTranscribedText preserves Burmese-only output when translateEnabled is true", () => {
      const result = sanitizeTranscribedText("ပြန်တော့လုပ်ရဦးမလားလို့", "Cursor", "code_comment", undefined, true);

      expect(result).toBe("ပြန်တော့လုပ်ရဦးမလားလို့");
    });
  });

  describe("3. Selection Transform Mode under Coding Preset", () => {
    test("resolves coding preset for coding editor apps", () => {
      expect(resolveEffectivePreset("code_comment", "Cursor")).toBe("code_comment");
      expect(resolveEffectivePreset("code_comment", "VS Code")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Zed")).toBe("code_comment");
    });
  });

  describe("4. Zero Conversational Intros & Zero Unrequested Code Block Hallucinations", () => {
    test("sanitizer strips wrapping double, single, and curly quotes added by LLMs", () => {
      expect(sanitizeTranscribedText('"Return early if userId is null"', "VS Code", "code_comment", undefined, false)).toBe("Return early if userId is null");
      expect(sanitizeTranscribedText("'const userId = 123;'", "Cursor", "code_comment", undefined, false)).toBe("Const userId = 123;");
      expect(sanitizeTranscribedText("“Add inline code comments”", "VS Code", "code_comment", undefined, false)).toBe("Add inline code comments");
      expect(sanitizeTranscribedText("‘Check user permissions’", "Cursor", "code_comment", undefined, false)).toBe("Check user permissions");
    });

    test("both detect and translate prompt instructions enforce zero preambles and zero boilerplate directives", () => {
      const detectInstructions = getPresetPromptInstructions("code_comment", false);
      const translateInstructions = getPresetPromptInstructions("code_comment", true);

      expect(detectInstructions).toContain("ZERO CONVERSATIONAL PREAMBLES & ZERO BOILERPLATE");
      expect(translateInstructions).toContain("ZERO BOILERPLATE & ZERO PREAMBLES");
    });
  });

  describe("5. Spoken Casing Transforms & Language-Aware Comment Syntax", () => {
    test("sanitizeCodePresetText converts spoken casing commands and strips preambles", () => {
      const input = "Here is the specification: Check camel case user response and snake case created at";
      const result = sanitizeCodePresetText(input);

      expect(result).toBe("Check `userResponse` and `created_at`");
      expect(result).not.toContain("Here is the specification:");
    });

    test("sanitizeTranscribedText invokes sanitizeCodePresetText when translateEnabled is true for code_comment preset", () => {
      const input = "Here is the spec: Verify upper case api key for user";
      const result = sanitizeTranscribedText(input, "Cursor", "code_comment", undefined, true, "English");

      expect(result).toBe("Verify `API_KEY` for user");
    });

    test("getCommentSyntaxForFile resolves correct syntax per file extension", () => {
      expect(getCommentSyntaxForFile(".py")).toBe("#");
      expect(getCommentSyntaxForFile(".sh")).toBe("#");
      expect(getCommentSyntaxForFile(".sql")).toBe("--");
      expect(getCommentSyntaxForFile(".html")).toBe("<!-- ... -->");
      expect(getCommentSyntaxForFile(".ts")).toBe("//");
      expect(getCommentSyntaxForFile()).toBe("//");
    });
  });
});
