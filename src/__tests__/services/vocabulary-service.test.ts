import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPersistedVocabulary, savePersistedVocabulary } from "../../services/vocabulary-service.js";

const TEST_VOCAB_FILE = join(tmpdir(), "pi-voice-test-vocab", "vocabulary.json");

describe("vocabulary-service", () => {
  afterEach(() => {
    try {
      rmSync(join(tmpdir(), "pi-voice-test-vocab"), { recursive: true, force: true });
    } catch {}
  });

  test("migrates legacy terms, seeds hardcoded corrections, and is idempotent", () => {
    mkdirSync(join(tmpdir(), "pi-voice-test-vocab"), { recursive: true });
    const dictionaryFile = join(tmpdir(), "pi-voice-test-vocab", "dictionary.txt");
    const legacyFile = join(tmpdir(), "pi-voice-test-vocab", "legacy.json");
    writeFileSync(legacyFile, JSON.stringify({ customVocabulary: ["userId", "SarYayKaung (စာရေးကောင်း)"], presetVocabulary: { code_comment: ["kubectl"] } }));
    writeFileSync(dictionaryFile, "TBH\\n");
    const first = loadPersistedVocabulary(legacyFile, dictionaryFile);
    expect(first.version).toBe(2);
    expect(first.entries?.some((entry) => entry.phrase === "MAS 141")).toBe(true);
    expect(first.entries?.find((entry) => entry.phrase === "MAS 141")?.spokenAliases).toContain("မက်စ်\t၁၄၁");
    expect(first.entries?.find((entry) => entry.phrase === "SarYayKaung")?.spokenAliases).toContain("စာရေး  ကောင်း");
    expect(first.entries?.some((entry) => entry.phrase === "userId")).toBe(true);
    expect(first.entries?.some((entry) => entry.phrase === "kubectl")).toBe(true);
    const before = readFileSync(legacyFile, "utf8");
    const second = loadPersistedVocabulary(legacyFile, dictionaryFile);
    expect(second.entries).toEqual(first.entries);
    expect(readFileSync(legacyFile, "utf8")).toBe(before);
  });

  test("leaves malformed vocabulary data untouched", () => {
    mkdirSync(join(tmpdir(), "pi-voice-test-vocab"), { recursive: true });
    const malformed = join(tmpdir(), "pi-voice-test-vocab", "malformed.json");
    const original = '{"customVocabulary":"not-an-array"}';
    writeFileSync(malformed, original);
    expect(loadPersistedVocabulary(malformed).entries).toBeUndefined();
    expect(readFileSync(malformed, "utf8")).toBe(original);
  });

  test("savePersistedVocabulary writes vocabulary.json and loadPersistedVocabulary restores it", () => {
    const mockVocab = {
      customVocabulary: ["myanso", "antigravity"],
      presetVocabulary: {
        code_comment: ["resolveConfigPath", "settleMatchingLifecycleError"],
        burmese_written: ["စကားပြော"],
      },
    };

    savePersistedVocabulary(mockVocab, TEST_VOCAB_FILE);
    expect(existsSync(TEST_VOCAB_FILE)).toBe(true);

    const loaded = loadPersistedVocabulary(TEST_VOCAB_FILE);
    expect(loaded.customVocabulary).toEqual(["myanso", "antigravity"]);
    expect(loaded.presetVocabulary.code_comment).toEqual(["resolveConfigPath", "settleMatchingLifecycleError"]);
    expect(loaded.presetVocabulary.burmese_written).toEqual(["စကားပြော"]);
  });
});
