import { describe, test, expect } from "bun:test";
import { DictionaryEngine, validateDictionaryEntries, applyDictionary } from "../../services/dictionary-engine.js";
import { migrateVocabulary, dictionaryEntryFromTerm, deriveLegacyCustomVocabulary, deriveLegacyPresetVocabulary } from "../../services/vocabulary-service.js";
import type { DictionaryEntry } from "../../shared/types.js";

describe("VO Vocabulary Consolidation Suite", () => {
  test("migrates customVocabulary as person_name and presetVocabulary as technical preset-scoped entries losslessly", () => {
    const customVocab = ["Aung Aung", "Kaung Myat - ကောင်းမြတ်"];
    const presetVocab = {
      code_comment: ["TypeScript", "bun"],
      email_polish: ["Sincerely"],
    };

    const entries = migrateVocabulary(customVocab, presetVocab);

    // Person name check
    const aung = entries.find((e) => e.phrase === "Aung Aung");
    expect(aung).toBeDefined();
    expect(aung?.category).toBe("person_name");
    expect(aung?.preset).toBeUndefined();

    const kaung = entries.find((e) => e.phrase === "ကောင်းမြတ်");
    expect(kaung).toBeDefined();
    expect(kaung?.category).toBe("person_name");
    expect(kaung?.spokenAliases).toContain("Kaung Myat");

    // Preset scoped check
    const ts = entries.find((e) => e.phrase === "TypeScript");
    expect(ts).toBeDefined();
    expect(ts?.category).toBe("technical");
    expect(ts?.preset).toBe("code_comment");

    const sin = entries.find((e) => e.phrase === "Sincerely");
    expect(sin).toBeDefined();
    expect(sin?.category).toBe("technical");
    expect(sin?.preset).toBe("email_polish");

    // Legacy read compatibility views
    const derivedCustom = deriveLegacyCustomVocabulary(entries);
    expect(derivedCustom).toContain("Aung Aung");
    expect(derivedCustom).toContain("ကောင်းမြတ်");

    const derivedPreset = deriveLegacyPresetVocabulary(entries);
    expect(derivedPreset.code_comment).toContain("TypeScript");
    expect(derivedPreset.code_comment).toContain("bun");
    expect(derivedPreset.email_polish).toContain("Sincerely");
  });

  test("preset-scoped entries apply ONLY when matching the active preset and do not leak", () => {
    const entries: DictionaryEntry[] = [
      { id: "1", phrase: "GLOBAL_TERM", spokenAliases: ["gt"], enabled: true },
      { id: "2", phrase: "CODE_TERM", spokenAliases: ["ct"], enabled: true, preset: "code_comment", category: "technical" },
      { id: "3", phrase: "EMAIL_TERM", spokenAliases: ["et"], enabled: true, preset: "email_polish", category: "general" },
    ];

    // Global active preset: code_comment
    const textCode = applyDictionary("gt and ct and et", entries, "code_comment");
    expect(textCode).toBe("GLOBAL_TERM and CODE_TERM and et"); // et is not replaced because it is scoped to email_polish!

    // Global active preset: email_polish
    const textEmail = applyDictionary("gt and ct and et", entries, "email_polish");
    expect(textEmail).toBe("GLOBAL_TERM and ct and EMAIL_TERM"); // ct is not replaced because it is scoped to code_comment!

    // No active preset specified (or all): matches all enabled entries
    const textAll = applyDictionary("gt and ct and et", entries, "all");
    expect(textAll).toBe("GLOBAL_TERM and CODE_TERM and EMAIL_TERM");
  });

  test("conflict validation detects conflicts within scope overlap and allows non-overlapping preset aliases", () => {
    // Non-overlapping preset scope: same alias 'test' mapping to different phrases in different presets
    const nonConflicting: DictionaryEntry[] = [
      { id: "1", phrase: "CodeTest", spokenAliases: ["test"], enabled: true, preset: "code_comment" },
      { id: "2", phrase: "EmailTest", spokenAliases: ["test"], enabled: true, preset: "email_polish" },
    ];
    expect(validateDictionaryEntries(nonConflicting)).toEqual([]);

    // Conflicting scope overlap: global entry vs preset entry mapping same alias 'test' to different phrases
    const conflicting: DictionaryEntry[] = [
      { id: "1", phrase: "GlobalTest", spokenAliases: ["test"], enabled: true },
      { id: "2", phrase: "CodeTest", spokenAliases: ["test"], enabled: true, preset: "code_comment" },
    ];
    const errors = validateDictionaryEntries(conflicting);
    expect(errors.length).toBe(1);
    expect(errors[0]?.alias).toBe("test");
  });

  test("person names support canonical phrase and alias mapping like other entries", () => {
    const entries: DictionaryEntry[] = [
      { id: "p1", phrase: "Aung Aung", spokenAliases: ["အောင်အောင်", "အာင်အာင်"], enabled: true, category: "person_name" },
    ];

    const engine = new DictionaryEngine(entries);
    expect(engine.process("ကို အောင်အောင် လာတယ်")).toBe("ကို Aung Aung လာတယ်");
    expect(engine.process("ကို အာင်အာင် လာတယ်")).toBe("ကို Aung Aung လာတယ်");
  });
});
