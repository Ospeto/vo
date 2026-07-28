import { describe, expect, test } from "bun:test";
import { DictionaryEngine, validateDictionaryEntries } from "../../services/dictionary-engine.js";
import type { DictionaryEntry } from "../../shared/types.js";

const entry = (id: string, phrase: string, aliases: string[] = [phrase], enabled = true): DictionaryEntry => ({ id, phrase, spokenAliases: aliases, enabled });

describe("DictionaryEngine", () => {
  test("matches identifiers safely and preserves exact canonical spelling", () => {
    const engine = new DictionaryEngine([entry("in", "IN"), entry("cat", "CAT"), entry("id", "userId", ["user id"])]);
    expect(engine.process("thinking in category user id")).toBe("thinking IN category userId");
  });

  test("uses longest alias first and never cascades replacements", () => {
    const engine = new DictionaryEngine([
      entry("short", "A", ["alpha"]),
      entry("long", "alpha", ["alpha beta"]),
      entry("loop", "alpha beta", ["loop"]),
    ]);
    expect(engine.process("alpha beta and loop")).toBe("alpha and alpha beta");
  });

  test("matches Burmese aliases inside unspaced Burmese text", () => {
    const engine = new DictionaryEngine([entry("name", "SarYayKaung", ["စာရေးကောင်း"])]);
    expect(engine.process("သူကစာရေးကောင်းပါ")).toBe("သူကSarYayKaungပါ");
  });

  test("disabled entries do nothing and conflicts are surfaced", () => {
    expect(new DictionaryEngine([entry("off", "CAT", ["cat"], false)]).process("cat")).toBe("cat");
    expect(validateDictionaryEntries([entry("a", "A", ["spoken"]), entry("b", "B", ["SPOKEN"])]).length).toBe(1);
  });
});
