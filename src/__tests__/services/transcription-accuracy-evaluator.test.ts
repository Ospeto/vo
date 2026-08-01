import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import {
  tokenizeText,
  detectDuplicatedFragments,
  alignWords,
  evaluateTranscriptPair,
  evaluateAccuracyCase,
  evaluateAccuracySuite,
  loadAccuracyFixtureSuite,
  type AccuracyTestCase,
  type AccuracyFixtureSuite,
} from "../../services/transcription-accuracy-evaluator.js";

describe("VO Transcript Post-processing Accuracy Evaluator & Metrics Suite (Round 6)", () => {
  describe("1. Tokenization & Text Segmentation", () => {
    test("handles empty or whitespace-only strings gracefully", () => {
      expect(tokenizeText("")).toEqual([]);
      expect(tokenizeText("   ")).toEqual([]);
    });

    test("tokenizes English words and strips outer punctuation", () => {
      const tokens = tokenizeText("Hello, world! This is a test.");
      expect(tokens).toEqual(["Hello", "world", "This", "is", "a", "test"]);
    });

    test("preserves technical identifiers, URLs, and package names intact", () => {
      const tokens = tokenizeText("Check https://example.invalid/api/v1 and @scope/pkg for userId.");
      expect(tokens).toEqual([
        "Check",
        "https://example.invalid/api/v1",
        "and",
        "@scope/pkg",
        "for",
        "userId",
      ]);
    });

    test("tokenizes Burmese script sentences accurately", () => {
      const tokens = tokenizeText("ဒီနေ့ ရာသီဥတု သာယာပါသည်။");
      expect(tokens).toEqual(["ဒီနေ့", "ရာသီဥတု", "သာယာပါသည်"]);
    });
  });

  describe("2. Duplicated Fragment & Stutter Detection", () => {
    test("returns empty array when text has zero stutters", () => {
      expect(detectDuplicatedFragments("The database connection is active")).toEqual([]);
    });

    test("detects single word stutters", () => {
      const duplicates = detectDuplicatedFragments("the the database is ready");
      expect(duplicates.length).toBe(1);
      expect(duplicates[0]!.fragment).toBe("the");
      expect(duplicates[0]!.count).toBe(2);
    });

    test("detects multi-word repeated n-gram fragments (2-5 words)", () => {
      const duplicates = detectDuplicatedFragments("we need to check we need to check the database");
      expect(duplicates.length).toBeGreaterThanOrEqual(1);
      expect(duplicates.some(d => d.fragment.toLowerCase() === "we need to check")).toBe(true);
    });

    test("detects Burmese multi-word duplicate stutters", () => {
      const duplicates = detectDuplicatedFragments("အဆင်ပြေအောင် အဆင်ပြေအောင် ဆောင်ရွက်ပေးပါ");
      expect(duplicates.length).toBe(1);
      expect(duplicates[0]!.fragment).toBe("အဆင်ပြေအောင်");
      expect(duplicates[0]!.count).toBe(2);
    });

    test("reports only the longest overlapping duplicated fragment", () => {
      const duplicates = detectDuplicatedFragments("then go go then go go");
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]!.fragment).toBe("then go go");
      expect(duplicates[0]!.count).toBe(2);
    });
  });

  describe("3. Word Error Rate (WER) & Alignment Matrix Metrics", () => {
    test("calculates exact match metrics (0 WER, 1.0 Accuracy)", () => {
      const report = evaluateTranscriptPair("Hello world test", "Hello world test");
      expect(report.hits).toBe(3);
      expect(report.substitutions).toBe(0);
      expect(report.insertions).toBe(0);
      expect(report.deletions).toBe(0);
      expect(report.wordErrorRate).toBe(0.0);
      expect(report.accuracy).toBe(1.0);
    });

    test("identifies substitution-only edits accurately", () => {
      const report = evaluateTranscriptPair("the quick brown fox", "the fast brown fox");
      expect(report.hits).toBe(3);
      expect(report.substitutions).toBe(1);
      expect(report.insertions).toBe(0);
      expect(report.deletions).toBe(0);
      expect(report.wordErrorRate).toBe(0.25);
      expect(report.substitutionDetails).toEqual([
        { expected: "quick", actual: "fast", expectedIndex: 1, actualIndex: 1 },
      ]);
    });

    test("identifies insertion-only edits accurately", () => {
      const report = evaluateTranscriptPair("check the log", "check all the log");
      expect(report.hits).toBe(3);
      expect(report.insertions).toBe(1);
      expect(report.substitutions).toBe(0);
      expect(report.deletions).toBe(0);
      expect(report.wordErrorRate).toBe(0.3333);
      expect(report.insertionDetails).toEqual([
        { actual: "all", actualIndex: 1 },
      ]);
    });

    test("identifies deletion-only edits accurately", () => {
      const report = evaluateTranscriptPair("check all the log", "check the log");
      expect(report.hits).toBe(3);
      expect(report.deletions).toBe(1);
      expect(report.substitutions).toBe(0);
      expect(report.insertions).toBe(0);
      expect(report.wordErrorRate).toBe(0.25);
      expect(report.deletionDetails).toEqual([
        { expected: "all", expectedIndex: 1 },
      ]);
    });

    test("computes mixed edit distance matrix and reports detailed diff operations", () => {
      const report = evaluateTranscriptPair("run bun test watch", "run npm test --watch extra");
      expect(report.diffOps.length).toBeGreaterThan(0);
      expect(report.wordErrorRate).toBeGreaterThan(0);
      expect(report.expectedWordCount).toBe(4);
      expect(report.actualWordCount).toBe(5);
    });

    test("rejects casing, punctuation, and protected-token regressions hidden by normalized WER", () => {
      const casing = evaluateAccuracyCase({
        id: "case", category: "technical_terms", description: "case", input: "api_key", expected: "API_KEY",
        protectedTokens: ["API_KEY"],
      });
      const punctuation = evaluateAccuracyCase({
        id: "punctuation", category: "punctuation", description: "punctuation", input: "is question mark it ready", expected: "Is it ready?",
        maxWerThreshold: 0,
      });
      const relativePath = evaluateAccuracyCase({
        id: "path", category: "technical_terms", description: "path", input: "check src main ts", expected: "Check src/main.ts",
        protectedTokens: ["src/main.ts"], maxWerThreshold: 1,
      });

      expect(casing.report.wordErrorRate).toBe(0);
      expect(casing.report.protectedTokensMatch).toBe(false);
      expect(casing.passed).toBe(false);
      expect(punctuation.report.wordErrorRate).toBe(0);
      expect(punctuation.report.punctuationMatch).toBe(false);
      expect(punctuation.passed).toBe(false);
      expect(relativePath.report.protectedTokensMatch).toBe(false);
      expect(relativePath.passed).toBe(false);
    });

    test("allows threshold-authorized word edits without moving punctuation", () => {
      const report = evaluateTranscriptPair("Hello world.", "Hello brave world.");
      expect(report.wordErrorRate).toBe(0.5);
      expect(report.punctuationMatch).toBe(true);
    });
  });

  describe("4. Fixture Loading & Captain Case Extensibility", () => {
    test("loads built-in fixture suite cleanly", () => {
      const fixturePath = join(process.cwd(), "src", "__tests__", "fixtures", "accuracy-round6-eval.json");
      const suite = loadAccuracyFixtureSuite(fixturePath);

      expect(suite.cases.length).toBeGreaterThanOrEqual(20);
      expect(suite.version).toBe("1.0.0");
    });

    test("allows captain to provide custom fixture JSON object without changing evaluator code", () => {
      const captainSuite: AccuracyFixtureSuite = {
        version: "1.0.0-captain",
        description: "Captain Provided Custom Case",
        cases: [
          {
            id: "captain-01",
            category: "names",
            description: "Captain provided specific name dictation",
            input: "captain test for SarYayKaung",
            expected: "Captain test for SarYayKaung",
            context: { preset: "careful" },
          },
        ],
      };

      const suite = loadAccuracyFixtureSuite(captainSuite);
      expect(suite.cases.length).toBe(1);
      const report = evaluateAccuracySuite(suite);
      expect(report.totalCases).toBe(1);
      expect(report.passedCases).toBe(1);
    });

    test("allows captain to provide raw JSON string", () => {
      const rawJson = JSON.stringify({
        version: "1.0.0-custom",
        description: "Raw JSON string suite",
        cases: [
          {
            id: "raw-01",
            category: "short_commands",
            description: "Custom command test",
            input: "git status.",
            expected: "Git status",
            context: { activeApp: "ghostty", preset: "code_comment" },
          },
        ],
      });

      const suite = loadAccuracyFixtureSuite(rawJson);
      expect(suite.cases[0]!.id).toBe("raw-01");
      const result = evaluateAccuracyCase(suite.cases[0]!);
      expect(result.passed).toBe(true);
    });
  });

  describe("5. Full Fixture Suite Execution & Category Coverage Assertion", () => {
    const fixturePath = join(process.cwd(), "src", "__tests__", "fixtures", "accuracy-round6-eval.json");
    const suite = loadAccuracyFixtureSuite(fixturePath);
    const report = evaluateAccuracySuite(suite);

    test("verifies all required categories are present in the fixture suite", () => {
      const categories = new Set(suite.cases.map(c => c.category));
      const requiredCategories = [
        "names",
        "technical_terms",
        "numbers",
        "punctuation",
        "short_commands",
        "long_dictation",
        "mixed_burmese_english",
        "personal_phrases",
        "endpointing",
        "microphone_diagnostics",
        "language_stability",
        "vocabulary_hints",
        "deterministic_corrections",
      ];

      for (const reqCat of requiredCategories) {
        expect(categories.has(reqCat)).toBe(true);
      }
    });

    test("passes 100% of test cases in the Round 6 accuracy evaluation suite with 0 failures", () => {
      expect(report.failedCases).toBe(0);
      expect(report.passedCases).toBe(report.totalCases);
      expect(report.averageWordErrorRate).toBe(0.0);
      expect(report.averageAccuracy).toBe(1.0);
    });
  });
});
