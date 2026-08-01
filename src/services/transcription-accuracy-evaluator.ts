import { existsSync, readFileSync } from "node:fs";
import type { DictionaryEntry, DictationPreset } from "../shared/types.js";
import { sanitizeTranscribedText } from "./stt.js";
import { SpeechEndpointDetector, diagnoseAudioStats, type AudioRecordingStats, type AudioDiagnosticResult } from "../shared/audio-utils.js";

export interface AccuracyDiffOp {
  type: "match" | "substitution" | "insertion" | "deletion";
  expected?: string;
  actual?: string;
  expectedIndex?: number;
  actualIndex?: number;
}

export interface DuplicatedFragment {
  fragment: string;
  count: number;
  wordCount: number;
  indices: number[];
}

export interface AccuracyReport {
  expectedText: string;
  actualText: string;
  expectedWordCount: number;
  actualWordCount: number;
  hits: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  wordErrorRate: number;
  accuracy: number;
  diffOps: AccuracyDiffOp[];
  substitutionDetails: Array<{ expected: string; actual: string; expectedIndex: number; actualIndex: number }>;
  insertionDetails: Array<{ actual: string; actualIndex: number }>;
  deletionDetails: Array<{ expected: string; expectedIndex: number }>;
  duplicatedFragments: DuplicatedFragment[];
}

export type AccuracyCategory =
  | "names"
  | "technical_terms"
  | "numbers"
  | "punctuation"
  | "short_commands"
  | "long_dictation"
  | "mixed_burmese_english"
  | "personal_phrases"
  | "endpointing"
  | "microphone_diagnostics"
  | "language_stability"
  | "vocabulary_hints"
  | "deterministic_corrections"
  | (string & {});

export interface AccuracyTestCase {
  id: string;
  category: AccuracyCategory;
  description: string;
  input: string;
  expected: string;
  maxWerThreshold?: number;
  context?: {
    activeApp?: string;
    preset?: DictationPreset;
    translateEnabled?: boolean;
    targetLanguage?: string;
    dictionaryEntries?: DictionaryEntry[];
    audioStats?: AudioRecordingStats;
    endpointingScenario?: {
      frames: Array<{ rms: number; isSpeech: boolean }>;
      confirmSilenceMs?: number;
      expectedEndpointed: boolean;
    };
    expectedDiagnosticStatus?: AudioDiagnosticResult["status"];
  };
}

export interface AccuracyFixtureSuite {
  version: string;
  description: string;
  cases: AccuracyTestCase[];
}

export interface CategorySummary {
  category: string;
  count: number;
  passedCount: number;
  averageWer: number;
  averageAccuracy: number;
  totalSubstitutions: number;
  totalInsertions: number;
  totalDeletions: number;
}

export interface CaseEvalResult {
  caseId: string;
  category: AccuracyCategory;
  description: string;
  passed: boolean;
  actualOutput: string;
  report: AccuracyReport;
  diagnosticResult?: AudioDiagnosticResult;
  endpointed?: boolean;
}

export interface AccuracySuiteReport {
  suiteDescription: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageWordErrorRate: number;
  averageAccuracy: number;
  totalHits: number;
  totalSubstitutions: number;
  totalInsertions: number;
  totalDeletions: number;
  totalDuplicatedFragments: number;
  categorySummaries: Record<string, CategorySummary>;
  caseResults: CaseEvalResult[];
}

export interface EvalOptions {
  maxAllowedWer?: number;
}

/** Tokenize text into words for accuracy computation. */
export function tokenizeText(text: string): string[] {
  if (!text || !text.trim()) return [];
  const normalized = text.trim();
  const rawTokens = normalized.split(/\s+/);
  const tokens: string[] = [];

  for (const token of rawTokens) {
    if (!token) continue;
    // Strip outer punctuation unless the token is purely punctuation or a URL/path/identifier
    if (/^(https?:\/\/|git@|\/|@)/i.test(token)) {
      tokens.push(token);
    } else {
      const stripped = token.replace(/^[.,?!:;"'“”‘’()\u104E\u104F\u104A\u104B]+|[.,?!:;"'“”‘’()\u104E\u104F\u104A\u104B]+$/g, "");
      tokens.push(stripped.length > 0 ? stripped : token);
    }
  }

  return tokens;
}

/** Detect obvious duplicated fragments (single word stutters or 2-5 word n-gram repetitions). */
export function detectDuplicatedFragments(text: string): DuplicatedFragment[] {
  if (!text || !text.trim()) return [];
  const tokens = tokenizeText(text);
  if (tokens.length < 2) return [];

  const duplicates: DuplicatedFragment[] = [];

  // Check 1-gram to 5-gram consecutive duplicates
  for (let gramSize = 1; gramSize <= Math.min(5, Math.floor(tokens.length / 2)); gramSize++) {
    let i = 0;
    while (i <= tokens.length - 2 * gramSize) {
      const gram1 = tokens.slice(i, i + gramSize).map(t => t.toLowerCase()).join(" ");
      let matchCount = 1;
      const positions: number[] = [i];

      let nextPos = i + gramSize;
      while (nextPos + gramSize <= tokens.length) {
        const nextGram = tokens.slice(nextPos, nextPos + gramSize).map(t => t.toLowerCase()).join(" ");
        if (nextGram === gram1) {
          matchCount++;
          positions.push(nextPos);
          nextPos += gramSize;
        } else {
          break;
        }
      }

      if (matchCount > 1) {
        const rawFragment = tokens.slice(i, i + gramSize).join(" ");
        // Avoid duplicate overlap reporting for smaller grams inside larger grams
        const alreadyCovered = duplicates.some(
          d => d.indices.some(idx => positions.includes(idx)) && d.wordCount >= gramSize
        );
        if (!alreadyCovered) {
          duplicates.push({
            fragment: rawFragment,
            count: matchCount,
            wordCount: gramSize,
            indices: positions,
          });
        }
        i = nextPos;
      } else {
        i++;
      }
    }
  }

  return duplicates;
}

/** Compute word-level Levenshtein edit distance alignment matrix between expected and actual tokens. */
export function alignWords(expectedTokens: string[], actualTokens: string[]): {
  hits: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  wordErrorRate: number;
  accuracy: number;
  diffOps: AccuracyDiffOp[];
  substitutionDetails: Array<{ expected: string; actual: string; expectedIndex: number; actualIndex: number }>;
  insertionDetails: Array<{ actual: string; actualIndex: number }>;
  deletionDetails: Array<{ expected: string; expectedIndex: number }>;
} {
  const m = expectedTokens.length;
  const n = actualTokens.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) {
    const row = dp[i];
    if (row) row[0] = i;
  }
  const row0 = dp[0];
  if (row0) {
    for (let j = 0; j <= n; j++) row0[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    const row = dp[i]!;
    const prevRow = dp[i - 1]!;
    for (let j = 1; j <= n; j++) {
      const expNorm = (expectedTokens[i - 1] ?? "").toLowerCase();
      const actNorm = (actualTokens[j - 1] ?? "").toLowerCase();
      if (expNorm === actNorm) {
        row[j] = prevRow[j - 1]!;
      } else {
        const subCost = prevRow[j - 1]! + 1;
        const delCost = prevRow[j]! + 1;
        const insCost = row[j - 1]! + 1;
        row[j] = Math.min(subCost, delCost, insCost);
      }
    }
  }

  // Backtrack to build diff operations
  let i = m;
  let j = n;
  const reversedOps: AccuracyDiffOp[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const expNorm = (expectedTokens[i - 1] ?? "").toLowerCase();
      const actNorm = (actualTokens[j - 1] ?? "").toLowerCase();
      if (expNorm === actNorm) {
        reversedOps.push({
          type: "match",
          expected: expectedTokens[i - 1],
          actual: actualTokens[j - 1],
          expectedIndex: i - 1,
          actualIndex: j - 1,
        });
        i--;
        j--;
        continue;
      }

      const row = dp[i]!;
      const prevRow = dp[i - 1]!;
      const current = row[j]!;
      const sub = prevRow[j - 1]!;
      const del = prevRow[j]!;

      if (current === sub + 1) {
        reversedOps.push({
          type: "substitution",
          expected: expectedTokens[i - 1],
          actual: actualTokens[j - 1],
          expectedIndex: i - 1,
          actualIndex: j - 1,
        });
        i--;
        j--;
      } else if (current === del + 1) {
        reversedOps.push({
          type: "deletion",
          expected: expectedTokens[i - 1],
          expectedIndex: i - 1,
        });
        i--;
      } else {
        reversedOps.push({
          type: "insertion",
          actual: actualTokens[j - 1],
          actualIndex: j - 1,
        });
        j--;
      }
    } else if (i > 0) {
      reversedOps.push({
        type: "deletion",
        expected: expectedTokens[i - 1],
        expectedIndex: i - 1,
      });
      i--;
    } else {
      reversedOps.push({
        type: "insertion",
        actual: actualTokens[j - 1],
        actualIndex: j - 1,
      });
      j--;
    }
  }

  const diffOps = reversedOps.reverse();

  let hits = 0;
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;

  const substitutionDetails: Array<{ expected: string; actual: string; expectedIndex: number; actualIndex: number }> = [];
  const insertionDetails: Array<{ actual: string; actualIndex: number }> = [];
  const deletionDetails: Array<{ expected: string; expectedIndex: number }> = [];

  for (const op of diffOps) {
    if (op.type === "match") {
      hits++;
    } else if (op.type === "substitution") {
      substitutions++;
      substitutionDetails.push({
        expected: op.expected ?? "",
        actual: op.actual ?? "",
        expectedIndex: op.expectedIndex ?? -1,
        actualIndex: op.actualIndex ?? -1,
      });
    } else if (op.type === "insertion") {
      insertions++;
      insertionDetails.push({
        actual: op.actual ?? "",
        actualIndex: op.actualIndex ?? -1,
      });
    } else if (op.type === "deletion") {
      deletions++;
      deletionDetails.push({
        expected: op.expected ?? "",
        expectedIndex: op.expectedIndex ?? -1,
      });
    }
  }

  const denominator = Math.max(1, m);
  const wordErrorRate = Number(((substitutions + insertions + deletions) / denominator).toFixed(4));
  const accuracy = Number(Math.max(0, 1 - wordErrorRate).toFixed(4));

  return {
    hits,
    substitutions,
    insertions,
    deletions,
    wordErrorRate,
    accuracy,
    diffOps,
    substitutionDetails,
    insertionDetails,
    deletionDetails,
  };
}

/** Evaluate expected vs actual transcript text with transparent word-level metrics. */
export function evaluateTranscriptPair(expectedText: string, actualText: string): AccuracyReport {
  const expectedTokens = tokenizeText(expectedText);
  const actualTokens = tokenizeText(actualText);

  const alignment = alignWords(expectedTokens, actualTokens);
  const duplicatedFragments = detectDuplicatedFragments(actualText);

  return {
    expectedText,
    actualText,
    expectedWordCount: expectedTokens.length,
    actualWordCount: actualTokens.length,
    hits: alignment.hits,
    substitutions: alignment.substitutions,
    insertions: alignment.insertions,
    deletions: alignment.deletions,
    wordErrorRate: alignment.wordErrorRate,
    accuracy: alignment.accuracy,
    diffOps: alignment.diffOps,
    substitutionDetails: alignment.substitutionDetails,
    insertionDetails: alignment.insertionDetails,
    deletionDetails: alignment.deletionDetails,
    duplicatedFragments,
  };
}

/** Evaluate a single accuracy test case. */
export function evaluateAccuracyCase(caseItem: AccuracyTestCase): CaseEvalResult {
  const ctx = caseItem.context;
  let actualOutput = "";
  let diagnosticResult: AudioDiagnosticResult | undefined;
  let endpointed: boolean | undefined;

  if (caseItem.category === "endpointing" && ctx?.endpointingScenario) {
    const detector = new SpeechEndpointDetector({
      confirmSilenceMs: ctx.endpointingScenario.confirmSilenceMs ?? 1500,
    });
    for (const frame of ctx.endpointingScenario.frames) {
      detector.processFrame(frame.rms);
    }
    endpointed = detector.getStatus().isEndpointed;
    actualOutput = endpointed ? "endpointed: true" : "endpointed: false";
  } else if (caseItem.category === "microphone_diagnostics" && ctx?.audioStats) {
    diagnosticResult = diagnoseAudioStats(ctx.audioStats);
    actualOutput = diagnosticResult.status;
  } else {
    actualOutput = sanitizeTranscribedText(
      caseItem.input,
      ctx?.activeApp,
      ctx?.preset,
      ctx?.dictionaryEntries,
      ctx?.translateEnabled,
      ctx?.targetLanguage
    );
  }

  const report = evaluateTranscriptPair(caseItem.expected, actualOutput);
  const werThreshold = caseItem.maxWerThreshold ?? 0.0; // default 0.0 WER (100% exact match requirement unless specified)
  const passed = report.wordErrorRate <= werThreshold;

  return {
    caseId: caseItem.id,
    category: caseItem.category,
    description: caseItem.description,
    passed,
    actualOutput,
    report,
    diagnosticResult,
    endpointed,
  };
}

/** Evaluate an entire accuracy suite. */
export function evaluateAccuracySuite(suite: AccuracyFixtureSuite, options?: EvalOptions): AccuracySuiteReport {
  const caseResults: CaseEvalResult[] = [];
  const categoryMap: Record<string, CategorySummary> = {};

  let totalHits = 0;
  let totalSubstitutions = 0;
  let totalInsertions = 0;
  let totalDeletions = 0;
  let totalDuplicatedFragments = 0;
  let sumWer = 0;
  let sumAcc = 0;
  let passedCases = 0;

  for (const caseItem of suite.cases) {
    const evalRes = evaluateAccuracyCase(caseItem);
    if (options?.maxAllowedWer !== undefined) {
      evalRes.passed = evalRes.report.wordErrorRate <= options.maxAllowedWer;
    }

    if (evalRes.passed) passedCases++;

    totalHits += evalRes.report.hits;
    totalSubstitutions += evalRes.report.substitutions;
    totalInsertions += evalRes.report.insertions;
    totalDeletions += evalRes.report.deletions;
    totalDuplicatedFragments += evalRes.report.duplicatedFragments.length;
    sumWer += evalRes.report.wordErrorRate;
    sumAcc += evalRes.report.accuracy;

    caseResults.push(evalRes);

    const cat = caseItem.category;
    if (!categoryMap[cat]) {
      categoryMap[cat] = {
        category: cat,
        count: 0,
        passedCount: 0,
        averageWer: 0,
        averageAccuracy: 0,
        totalSubstitutions: 0,
        totalInsertions: 0,
        totalDeletions: 0,
      };
    }

    const catSummary = categoryMap[cat]!;
    catSummary.count++;
    if (evalRes.passed) catSummary.passedCount++;
    catSummary.averageWer += evalRes.report.wordErrorRate;
    catSummary.averageAccuracy += evalRes.report.accuracy;
    catSummary.totalSubstitutions += evalRes.report.substitutions;
    catSummary.totalInsertions += evalRes.report.insertions;
    catSummary.totalDeletions += evalRes.report.deletions;
  }

  const totalCases = suite.cases.length;
  for (const catKey of Object.keys(categoryMap)) {
    const catSummary = categoryMap[catKey]!;
    if (catSummary.count > 0) {
      catSummary.averageWer = Number((catSummary.averageWer / catSummary.count).toFixed(4));
      catSummary.averageAccuracy = Number((catSummary.averageAccuracy / catSummary.count).toFixed(4));
    }
  }

  return {
    suiteDescription: suite.description,
    totalCases,
    passedCases,
    failedCases: totalCases - passedCases,
    averageWordErrorRate: totalCases > 0 ? Number((sumWer / totalCases).toFixed(4)) : 0,
    averageAccuracy: totalCases > 0 ? Number((sumAcc / totalCases).toFixed(4)) : 0,
    totalHits,
    totalSubstitutions,
    totalInsertions,
    totalDeletions,
    totalDuplicatedFragments,
    categorySummaries: categoryMap,
    caseResults,
  };
}

/** Load accuracy suite from JSON file path, JSON string, or object structure (captain extensible design). */
export function loadAccuracyFixtureSuite(source: string | object): AccuracyFixtureSuite {
  let parsed: any;

  if (typeof source === "string") {
    const trimmed = source.trim();
    if (trimmed.startsWith("{")) {
      parsed = JSON.parse(trimmed);
    } else if (existsSync(source)) {
      const content = readFileSync(source, "utf-8");
      parsed = JSON.parse(content);
    } else {
      throw new Error(`Accuracy fixture file or content not found: ${source}`);
    }
  } else {
    parsed = source;
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cases)) {
    throw new Error("Invalid accuracy fixture suite structure: missing 'cases' array");
  }

  return {
    version: parsed.version ?? "1.0.0",
    description: parsed.description ?? "VO Accuracy Evaluation Suite",
    cases: parsed.cases.map((c: any, index: number) => ({
      id: c.id ?? `case-${index + 1}`,
      category: c.category ?? "general",
      description: c.description ?? `Accuracy case ${index + 1}`,
      input: c.input ?? "",
      expected: c.expected ?? "",
      maxWerThreshold: c.maxWerThreshold,
      context: c.context,
    })),
  };
}
