import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, rmSync } from "node:fs";
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
