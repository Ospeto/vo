import { describe, test, expect } from "bun:test";
import { DictionaryEngine, validateDictionaryEntries, applyDictionary } from "../../services/dictionary-engine.js";
import { migrateVocabulary, dictionaryEntryFromTerm, deriveLegacyCustomVocabulary } from "../../services/vocabulary-service.js";
import type { DictionaryEntry } from "../../shared/types.js";
import { IPC } from "../../shared/types.js";

describe("VO Vocabulary Consolidation Suite", () => {
  test("migrates customVocabulary as person_name and presetVocabulary as technical entries losslessly without preset scope", () => {
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
    expect((aung as any)?.preset).toBeUndefined();

    const kaung = entries.find((e) => e.phrase === "ကောင်းမြတ်");
    expect(kaung).toBeDefined();
    expect(kaung?.category).toBe("person_name");
    expect(kaung?.spokenAliases).toContain("Kaung Myat");

    // Technical check
    const ts = entries.find((e) => e.phrase === "TypeScript");
    expect(ts).toBeDefined();
    expect(ts?.category).toBe("technical");
    expect((ts as any)?.preset).toBeUndefined();

    const sin = entries.find((e) => e.phrase === "Sincerely");
    expect(sin).toBeDefined();
    expect(sin?.category).toBe("technical");
    expect((sin as any)?.preset).toBeUndefined();

    // Verify NO entry has a preset field
    for (const entry of entries) {
      expect((entry as any).preset).toBeUndefined();
    }

    // Legacy read compatibility view for customVocabulary
    const derivedCustom = deriveLegacyCustomVocabulary(entries);
    expect(derivedCustom).toContain("Aung Aung");
    expect(derivedCustom).toContain("ကောင်းမြတ်");
  });

  test("dictionary entries apply deterministic local replacement unconditionally", () => {
    const entries: DictionaryEntry[] = [
      { id: "1", phrase: "GLOBAL_TERM", spokenAliases: ["gt"], enabled: true, category: "general" },
      { id: "2", phrase: "CODE_TERM", spokenAliases: ["ct"], enabled: true, category: "technical" },
      { id: "3", phrase: "EMAIL_TERM", spokenAliases: ["et"], enabled: true, category: "general" },
    ];

    const result = applyDictionary("gt and ct and et", entries);
    expect(result).toBe("GLOBAL_TERM and CODE_TERM and EMAIL_TERM");
  });

  test("conflict validation detects conflicts across all enabled entries", () => {
    const conflicting: DictionaryEntry[] = [
      { id: "1", phrase: "GlobalTest", spokenAliases: ["test"], enabled: true, category: "general" },
      { id: "2", phrase: "CodeTest", spokenAliases: ["test"], enabled: true, category: "technical" },
    ];
    const errors = validateDictionaryEntries(conflicting);
    expect(errors.length).toBe(1);
    expect(errors[0]?.alias).toBe("test");
  });

  test("category model supports exactly three categories: general, person_name, technical", () => {
    const entries: DictionaryEntry[] = [
      { id: "1", phrase: "General Term", spokenAliases: ["gen"], enabled: true, category: "general" },
      { id: "2", phrase: "Person Term", spokenAliases: ["person"], enabled: true, category: "person_name" },
      { id: "3", phrase: "Tech Term", spokenAliases: ["tech"], enabled: true, category: "technical" },
    ];

    for (const entry of entries) {
      expect(["general", "person_name", "technical"]).toContain(entry.category!);
    }

    // Migration normalizes legacy entries into valid categories
    const migrated = migrateVocabulary([], {}, [
      { id: "4", phrase: "Legacy Scope", spokenAliases: ["legacy"], enabled: true, category: "unknown" as any, preset: "code_comment" } as any,
    ]);

    const legacyEntry = migrated.find((e) => e.phrase === "Legacy Scope");
    expect(legacyEntry).toBeDefined();
    expect(["general", "person_name", "technical"]).toContain(legacyEntry!.category!);
    expect((legacyEntry as any).preset).toBeUndefined();
  });

  test("person names support canonical phrase and alias mapping like other entries", () => {
    const entries: DictionaryEntry[] = [
      { id: "p1", phrase: "Aung Aung", spokenAliases: ["အောင်အောင်", "အာင်အာင်"], enabled: true, category: "person_name" },
    ];

    const engine = new DictionaryEngine(entries);
    expect(engine.process("ကို အောင်အောင် လာတယ်")).toBe("ကို Aung Aung လာတယ်");
    expect(engine.process("ကို အာင်အာင် လာတယ်")).toBe("ကို Aung Aung လာတယ်");
  });

  test("confirms absence of PREVIEW_DICTIONARY IPC channel and live preview plumbing", () => {
    expect((IPC as any).PREVIEW_DICTIONARY).toBeUndefined();
  });
});
