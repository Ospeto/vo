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

  test("preserves legacy whitespace matching while honoring enabled state", () => {
    const enabled = entry("mas", "MAS 141", ["မက်စ် ၁၄၁"], true);
    enabled.legacyWhitespace = true;
    const disabled = { ...enabled, enabled: false };
    expect(new DictionaryEngine([enabled]).process("မက်စ်\u2003\u2003၁၄၁")).toBe("MAS 141");
    expect(new DictionaryEngine([disabled]).process("မက်စ်\u2003\u2003၁၄၁")).toBe("မက်စ်\u2003\u2003၁၄၁");
  });

  test("surfaces conflicts with legacy whitespace variants", () => {
    const legacy = entry("legacy", "MAS 141", ["မက်စ် ၁၄၁"]);
    legacy.legacyWhitespace = true;
    expect(validateDictionaryEntries([legacy, entry("other", "Other", ["မက်စ်\t၁၄၁"])]).length).toBe(1);
  });

  test("disabled entries do nothing and conflicts are surfaced", () => {
    expect(new DictionaryEngine([entry("off", "CAT", ["cat"], false)]).process("cat")).toBe("cat");
    expect(validateDictionaryEntries([entry("a", "A", ["spoken"]), entry("b", "B", ["SPOKEN"])]).length).toBe(1);
  });

  test("replaces alias 'loveish' with phrase 'lavish' case-insensitively", () => {
    const engine = new DictionaryEngine([entry("lavish-id", "lavish", ["loveish"])]);
    expect(engine.process("I bought a loveish house")).toBe("I bought a lavish house");
    expect(engine.process("Loveish items are nice")).toBe("lavish items are nice");
  });
});
