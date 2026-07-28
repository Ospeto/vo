import { describe, test, expect } from "bun:test";
import {
  prepareHintEntries,
  buildDictionaryPromptPart,
  buildCustomVocabularyPromptPart,
  buildOpenAIVocabularyPrompt,
  MAX_HINT_ENTRIES,
  MAX_HINT_TERMS,
  sanitizeTranscribedText,
  getAppContextPromptHint,
  resolveEffectivePreset,
} from "../../services/stt.js";
import { applyDictionary, DictionaryEngine } from "../../services/dictionary-engine.js";
import type { DictionaryEntry } from "../../shared/types.js";

describe("VO Contextual Transcription Hints & Correction Safety Suite", () => {
  test("1. Hint Construction & Soft Formatting: Formats enabled trusted terms and aliases as soft recognition hints", () => {
    const entries: DictionaryEntry[] = [
      { id: "1", phrase: "SarYayKaung", spokenAliases: ["စာရေးကောင်း", "စာရေး ကောင်း"], enabled: true, category: "general" },
      { id: "2", phrase: "Ospeto", spokenAliases: ["ဩစပေတို"], enabled: true, category: "person_name" },
      { id: "3", phrase: "MAS 141", spokenAliases: ["မက်စ် ၁၄၁"], enabled: true, category: "technical" },
    ];

    const promptPart = buildDictionaryPromptPart(entries);

    expect(promptPart).toContain("RECOGNITION VOCABULARY HINTS (soft guidance only; use only when supported by audio)");
    expect(promptPart).toContain('- Spoken sound/word "SarYayKaung" or "စာရေးကောင်း" or "စာရေး ကောင်း" ➔ Preferred spelling: "SarYayKaung"');
    expect(promptPart).toContain('- Spoken sound/word "Ospeto" or "ဩစပေတို" ➔ Preferred spelling: "Ospeto"');
    expect(promptPart).toContain('- Spoken sound/word "MAS 141" or "မက်စ် ၁၄၁" ➔ Preferred spelling: "MAS 141"');
  });

  test("2. OpenAI Hint Formatting: Formats entries into a concise comma-separated prompt string bounded to 30 terms", () => {
    const entries: DictionaryEntry[] = [
      { id: "1", phrase: "SarYayKaung", spokenAliases: ["စာရေးကောင်း"], enabled: true, category: "general" },
      { id: "2", phrase: "Ospeto", spokenAliases: ["ဩစပေတို"], enabled: true, category: "person_name" },
    ];

    const openaiPrompt = buildOpenAIVocabularyPrompt(entries);
    expect(openaiPrompt).toBe("SarYayKaung, စာရေးကောင်း, Ospeto, ဩစပေတို");
  });

  test("3. Disabled Entries Exclusion: Excludes entries with enabled: false from hint payload completely", () => {
    const entries: DictionaryEntry[] = [
      { id: "1", phrase: "EnabledTerm", spokenAliases: ["alias_enabled"], enabled: true, category: "general" },
      { id: "2", phrase: "DisabledTerm", spokenAliases: ["alias_disabled"], enabled: false, category: "general" },
    ];

    const prepared = prepareHintEntries(entries);
    expect(prepared.map((e) => e.phrase)).toContain("EnabledTerm");
    expect(prepared.map((e) => e.phrase)).not.toContain("DisabledTerm");

    const promptPart = buildDictionaryPromptPart(entries);
    expect(promptPart).toContain("EnabledTerm");
    expect(promptPart).not.toContain("DisabledTerm");
  });

  test("4. Conflicting Aliases Handling: Excludes conflicting aliases mapping to multiple distinct canonical phrases", () => {
    const entries: DictionaryEntry[] = [
      { id: "1", phrase: "ProjectAlpha", spokenAliases: ["shared_alias", "alpha_sound"], enabled: true, category: "technical" },
      { id: "2", phrase: "ProjectBeta", spokenAliases: ["shared_alias", "beta_sound"], enabled: true, category: "technical" },
    ];

    const prepared = prepareHintEntries(entries);
    const alphaEntry = prepared.find((e) => e.phrase === "ProjectAlpha");
    const betaEntry = prepared.find((e) => e.phrase === "ProjectBeta");

    expect(alphaEntry).toBeDefined();
    expect(betaEntry).toBeDefined();

    // "shared_alias" mapped to both ProjectAlpha and ProjectBeta -> MUST BE EXCLUDED
    expect(alphaEntry?.spokenAliases).not.toContain("shared_alias");
    expect(betaEntry?.spokenAliases).not.toContain("shared_alias");

    // Non-conflicting aliases remain intact
    expect(alphaEntry?.spokenAliases).toContain("alpha_sound");
    expect(betaEntry?.spokenAliases).toContain("beta_sound");

    const promptPart = buildDictionaryPromptPart(entries);
    expect(promptPart).not.toContain("shared_alias");
    expect(promptPart).toContain("alpha_sound");
    expect(promptPart).toContain("beta_sound");
  });

  test("5. Bounding & Capping: Bounds hint list size to MAX_HINT_ENTRIES (50) to prevent prompt bloat", () => {
    const oversizedEntries: DictionaryEntry[] = Array.from({ length: 80 }, (_, i) => ({
      id: `entry-${i}`,
      phrase: `Term_${i}`,
      spokenAliases: [`alias_${i}`],
      enabled: true,
      category: "general",
    }));

    const prepared = prepareHintEntries(oversizedEntries);
    expect(prepared.length).toBe(MAX_HINT_ENTRIES);
    expect(prepared.length).toBe(50);
  });

  test("5b. Bounding & Capping: Bounds aliases as well as canonical entries", () => {
    const entries: DictionaryEntry[] = [
      {
        id: "entry-0",
        phrase: "Term_0",
        spokenAliases: Array.from({ length: MAX_HINT_TERMS * 2 }, (_, i) => `alias_${i}`),
        enabled: true,
        category: "general",
      },
    ];

    const prepared = prepareHintEntries(entries);
    const emittedTerms = prepared.flatMap((entry) => [entry.phrase, ...entry.spokenAliases]);

    expect(emittedTerms.length).toBe(MAX_HINT_TERMS);
    expect(new Set(emittedTerms.map((term) => term.normalize("NFKC").toLocaleLowerCase())).size).toBe(MAX_HINT_TERMS);
    expect(buildOpenAIVocabularyPrompt(entries).split(", ").length).toBe(MAX_HINT_TERMS);
  });

  test("6. Category Handling: Preserves general, person_name, and technical categories seamlessly", () => {
    const entries: DictionaryEntry[] = [
      { id: "g1", phrase: "General Word", spokenAliases: ["gw"], enabled: true, category: "general" },
      { id: "p1", phrase: "Zaw Zaw", spokenAliases: ["ဇော်ဇော်"], enabled: true, category: "person_name" },
      { id: "t1", phrase: "TypeScript", spokenAliases: ["ts"], enabled: true, category: "technical" },
    ];

    const prepared = prepareHintEntries(entries);
    expect(prepared.find((e) => e.phrase === "General Word")?.category).toBe("general");
    expect(prepared.find((e) => e.phrase === "Zaw Zaw")?.category).toBe("person_name");
    expect(prepared.find((e) => e.phrase === "TypeScript")?.category).toBe("technical");

    const promptPart = buildDictionaryPromptPart(entries);
    expect(promptPart).toContain("General Word");
    expect(promptPart).toContain("Zaw Zaw");
    expect(promptPart).toContain("TypeScript");
  });

  test("7. Privacy Boundaries: Uses safe active window process name without sending clipboard or document contents", () => {
    const hint = getAppContextPromptHint("Ghostty");
    expect(hint).toContain("Active Window: Terminal/CLI");
    expect(hint).not.toContain("clipboard");
    expect(hint).not.toContain("document");

    const preset = resolveEffectivePreset("auto", "Obsidian");
    expect(preset).toBe("burmese_written");
  });

  test("8. Deterministic Local Replacement: Keeps applyDictionary authoritative, non-fuzzy, non-recursive, boundary-safe, and provider-agnostic", () => {
    const entries: DictionaryEntry[] = [
      { id: "1", phrase: "SarYayKaung", spokenAliases: ["စာရေးကောင်း"], enabled: true, category: "general" },
      { id: "2", phrase: "Ospeto", spokenAliases: ["ဩစပေတို"], enabled: true, category: "person_name" },
      { id: "3", phrase: "MAS 141", spokenAliases: ["မက်စ် ၁၄၁"], enabled: true, category: "technical" },
    ];

    // Authoritative exact replacement
    const rawTranscript = "စာရေးကောင်း က ဩစပေတို နဲ့ မက်စ် ၁၄၁ အကြောင်း ပြောခဲ့သည်";
    const postProcessed = sanitizeTranscribedText(rawTranscript, "Ghostty", "careful", entries);

    expect(postProcessed).toBe("SarYayKaung က Ospeto နဲ့ MAS 141 အကြောင်း ပြောခဲ့သည်");

    // Preserves original transcript when no exact dictionary match applies
    const unmappedTranscript = "ဒီနေ့ ရာသီဥတု သာယာပါတယ်";
    const unchanged = sanitizeTranscribedText(unmappedTranscript, "Ghostty", "careful", entries);
    expect(unchanged).toBe("ဒီနေ့ ရာသီဥတု သာယာပါတယ်");
  });

  test("9. Measurable Evaluation Fixture: Representative names and technical terms end-to-end evaluation", () => {
    const evaluationEntries: DictionaryEntry[] = [
      { id: "e1", phrase: "Aung Aung", spokenAliases: ["အောင်အောင်", "အာင်အာင်"], enabled: true, category: "person_name" },
      { id: "e2", phrase: "SarYayKaung", spokenAliases: ["စာရေးကောင်း"], enabled: true, category: "general" },
      { id: "e3", phrase: "Ospeto", spokenAliases: ["ဩစပေတို"], enabled: true, category: "person_name" },
      { id: "e4", phrase: "TBH Labs", spokenAliases: ["တီဘီအိတ်ချ် ဓာတ်ခွဲခန်း"], enabled: true, category: "technical" },
      { id: "e5", phrase: "MAS 142", spokenAliases: ["မက်စ် ၁၄၂"], enabled: true, category: "technical" },
    ];

    const testUtterances = [
      {
        input: "ကို အောင်အောင် က စာရေးကောင်း ကို ဩစပေတို နဲ့ တီဘီအိတ်ချ် ဓာတ်ခွဲခန်း မှာ တွေ့ခဲ့တယ်",
        expected: "ကို Aung Aung က SarYayKaung ကို Ospeto နဲ့ TBH Labs မှာ တွေ့ခဲ့တယ်",
      },
      {
        input: "မက်စ် ၁၄၂ အစီရင်ခံစာ ကို ဖတ်ပြီးပြီ",
        expected: "MAS 142 အစီရင်ခံစာ ကို ဖတ်ပြီးပြီ",
      },
    ];

    for (const item of testUtterances) {
      const output = sanitizeTranscribedText(item.input, "Ghostty", "careful", evaluationEntries);
      expect(output).toBe(item.expected);
    }
  });
});
