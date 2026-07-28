import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { DictionaryEntry, VocabularyCategory } from "../shared/types.js";
import logger from "./logger.js";

export interface PersistedVocabulary {
  version?: 2;
  /** Legacy fields remain as a lossless compatibility mirror. */
  customVocabulary: string[];
  presetVocabulary: Record<string, string[]>;
  entries?: DictionaryEntry[];
}

const TRUSTED_SEEDS: Array<[string, string[], VocabularyCategory?]> = [
  ["MAS 141", ["မက်စ် ၁၄၁", "မက်စ်၁၄၁", "မက်စ်\t၁၄၁", "မက်စ်  ၁၄၁"], "technical"],
  ["MAS 142", ["မက်စ် ၁၄၂", "မက်စ်၁၄၂", "မက်စ်\t၁၄၂", "မက်စ်  ၁၄၂"], "technical"],
  ["MAS 143", ["မက်စ် ၁၄၃", "မက်စ်၁၄၃", "မက်စ်\t၁၄၃", "မက်စ်  ၁၄၃"], "technical"],
  ["SarYayKaung", ["စာရေးကောင်း", "စာရေး ကောင်း", "စာရေး\tကောင်း", "စာရေး  ကောင်း", "စာရေးကောင်"], "general"],
  ["Ospeto", ["ဩစပေတို", "အိုစပေတို"], "person_name"],
  ["TBH", ["တီဘီအိတ်ချ်", "တီဘီအိတ်"], "technical"],
  ["Engram", ["အင်ဂရမ်", "အန်ဂရမ်"], "technical"],
];

export function resolveVocabularyPath(customPath?: string): string {
  if (customPath) return customPath;
  return join(homedir(), ".config", "pi-voice", "vocabulary.json");
}

function stableId(phrase: string, aliases: string[], category?: string, preset?: string): string {
  return `dict-${createHash("sha256").update(`${phrase}\n${aliases.join("\n")}\n${category || ""}\n${preset || ""}`).digest("hex").slice(0, 16)}`;
}

export function dictionaryEntryFromTerm(
  raw: string,
  category?: VocabularyCategory,
  preset?: string
): DictionaryEntry | null {
  const value = raw.trim();
  if (!value) return null;
  // Preserve the old human-readable mapping forms while making both sides searchable.
  const mapping = value.match(/^(.+?)\s+-\s+(.+)$/);
  if (mapping) {
    const left = mapping[1]!.trim();
    const right = mapping[2]!.trim();
    return {
      id: stableId(right, [left, right], category, preset),
      phrase: right,
      spokenAliases: [left, right],
      enabled: true,
      ...(category ? { category } : {}),
      ...(preset ? { preset } : {}),
    };
  }
  const parenthesized = value.match(/^(.+?)\s+\((.+)\)$/);
  if (parenthesized) {
    const phrase = parenthesized[1]!.trim();
    const alias = parenthesized[2]!.trim();
    return {
      id: stableId(phrase, [alias, phrase], category, preset),
      phrase,
      spokenAliases: [alias, phrase],
      enabled: true,
      ...(category ? { category } : {}),
      ...(preset ? { preset } : {}),
    };
  }
  return {
    id: stableId(value, [value], category, preset),
    phrase: value,
    spokenAliases: [value],
    enabled: true,
    ...(category ? { category } : {}),
    ...(preset ? { preset } : {}),
  };
}

function seededEntries(): DictionaryEntry[] {
  return TRUSTED_SEEDS.map(([phrase, aliases, cat]) => ({
    id: stableId(phrase, aliases, cat || "general"),
    phrase,
    spokenAliases: aliases,
    enabled: true,
    legacyWhitespace: true,
    category: cat || "general",
  }));
}

export function backfillLegacyWhitespace(entries: DictionaryEntry[]): DictionaryEntry[] {
  const legacyPhrases = new Set(TRUSTED_SEEDS.map(([phrase]) => phrase));
  return entries.map((entry) => legacyPhrases.has(entry.phrase) && entry.legacyWhitespace === undefined
    ? { ...entry, legacyWhitespace: true }
    : entry);
}

function mergeEntries(entries: DictionaryEntry[]): DictionaryEntry[] {
  const merged: DictionaryEntry[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw.phrase !== "string" || !Array.isArray(raw.spokenAliases)) continue;
    const phrase = raw.phrase.trim();
    const aliases = raw.spokenAliases.filter((alias): alias is string => typeof alias === "string").map((alias) => alias.trim()).filter(Boolean);
    if (!phrase) continue;
    const category = raw.category;
    const preset = raw.preset;
    const existing = merged.find((entry) => entry.phrase === phrase && entry.preset === preset);
    if (existing) {
      existing.spokenAliases = Array.from(new Set([...existing.spokenAliases, ...aliases, phrase]));
      if (!existing.category && category) existing.category = category;
    } else {
      merged.push({
        id: raw.id || stableId(phrase, aliases, category, preset),
        phrase,
        spokenAliases: Array.from(new Set([...aliases, phrase])),
        enabled: raw.enabled !== false,
        ...(category ? { category } : {}),
        ...(preset ? { preset } : {}),
        ...(raw.legacyWhitespace ? { legacyWhitespace: true } : {}),
      });
    }
  }
  return merged;
}

function mergeLegacyEntries(entries: DictionaryEntry[], legacyEntries: DictionaryEntry[]): DictionaryEntry[] {
  for (const legacy of legacyEntries) {
    const normPhrase = legacy.phrase.trim().normalize("NFKC").toLocaleLowerCase();
    const existing = entries.find(
      (entry) =>
        (entry.phrase === legacy.phrase || entry.phrase.trim().normalize("NFKC").toLocaleLowerCase() === normPhrase) &&
        entry.preset === legacy.preset
    );
    if (existing) {
      existing.spokenAliases = Array.from(new Set([...existing.spokenAliases, ...legacy.spokenAliases]));
    } else {
      entries.push(legacy);
    }
  }
  return entries;
}

function readUserDictionary(dictionaryPath: string): string[] {
  try {
    if (!existsSync(dictionaryPath)) return [];
    return readFileSync(dictionaryPath, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function validLegacyShape(parsed: any): boolean {
  if (parsed.customVocabulary !== undefined && (!Array.isArray(parsed.customVocabulary) || parsed.customVocabulary.some((value: unknown) => typeof value !== "string"))) return false;
  if (parsed.presetVocabulary !== undefined && (typeof parsed.presetVocabulary !== "object" || parsed.presetVocabulary === null || Object.values(parsed.presetVocabulary).some((values) => !Array.isArray(values) || values.some((value) => typeof value !== "string")))) return false;
  if (parsed.entries !== undefined && (!Array.isArray(parsed.entries) || parsed.entries.some((entry: any) => !entry || typeof entry.id !== "string" || typeof entry.phrase !== "string" || !Array.isArray(entry.spokenAliases) || entry.spokenAliases.some((alias: unknown) => typeof alias !== "string") || typeof entry.enabled !== "boolean"))) return false;
  return true;
}

export function migrateVocabulary(
  customVocabulary: string[] = [],
  presetVocabulary: Record<string, string[]> = {},
  existingEntries: DictionaryEntry[] = [],
  userDictionary: string[] = []
): DictionaryEntry[] {
  const customEntries = customVocabulary.map((term) => dictionaryEntryFromTerm(term, "person_name")).filter((e): e is DictionaryEntry => Boolean(e));
  const presetEntries: DictionaryEntry[] = [];
  for (const [preset, terms] of Object.entries(presetVocabulary)) {
    if (Array.isArray(terms)) {
      for (const term of terms) {
        const entry = dictionaryEntryFromTerm(term, "technical", preset);
        if (entry) presetEntries.push(entry);
      }
    }
  }
  const userDictEntries = userDictionary.map((term) => dictionaryEntryFromTerm(term, "general")).filter((e): e is DictionaryEntry => Boolean(e));
  return mergeLegacyEntries(mergeEntries([...seededEntries(), ...existingEntries]), [...customEntries, ...presetEntries, ...userDictEntries]);
}

export function deriveLegacyCustomVocabulary(entries: DictionaryEntry[]): string[] {
  const seedPhrases = new Set(TRUSTED_SEEDS.map(([phrase]) => phrase));
  return Array.from(new Set(entries.filter((e) => e.category === "person_name" || (!e.preset && !e.category && !seedPhrases.has(e.phrase))).map((e) => e.phrase)));
}

export function deriveLegacyPresetVocabulary(entries: DictionaryEntry[]): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  for (const entry of entries) {
    if (entry.preset) {
      const list = res[entry.preset] ?? [];
      if (!list.includes(entry.phrase)) {
        list.push(entry.phrase);
      }
      res[entry.preset] = list;
    }
  }
  return res;
}

export function loadPersistedVocabulary(customPath?: string, customDictionaryPath?: string): PersistedVocabulary {
  const filePath = resolveVocabularyPath(customPath);
  const targetDir = dirname(filePath);
  if (!existsSync(targetDir)) {
    try { mkdirSync(targetDir, { recursive: true }); } catch {}
  }

  if (!existsSync(filePath)) {
    const migrated = migrateVocabulary([], {}, [], readUserDictionary(customDictionaryPath || join(homedir(), ".pi", "dictionary.txt")));
    const customVocabulary = deriveLegacyCustomVocabulary(migrated);
    const presetVocabulary = deriveLegacyPresetVocabulary(migrated);
    return { version: 2 as const, customVocabulary, presetVocabulary, entries: migrated };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!validLegacyShape(parsed)) {
      logger.warn({ vocabPath: filePath }, "Vocabulary file has malformed fields; leaving it untouched");
      return { customVocabulary: [], presetVocabulary: {} };
    }
    const rawCustom = Array.isArray(parsed.customVocabulary) ? parsed.customVocabulary : [];
    const rawPreset = parsed.presetVocabulary && typeof parsed.presetVocabulary === "object" ? parsed.presetVocabulary : {};
    const entries = migrateVocabulary(
      rawCustom,
      rawPreset,
      Array.isArray(parsed.entries) ? parsed.entries : [],
      parsed.entries ? [] : readUserDictionary(customDictionaryPath || join(homedir(), ".pi", "dictionary.txt"))
    );
    const customVocabulary = Array.isArray(parsed.customVocabulary) ? parsed.customVocabulary : deriveLegacyCustomVocabulary(entries);
    const presetVocabulary = parsed.presetVocabulary && typeof parsed.presetVocabulary === "object" ? parsed.presetVocabulary : deriveLegacyPresetVocabulary(entries);
    const result: PersistedVocabulary = { version: 2, customVocabulary, presetVocabulary, entries };
    if (parsed.version !== 2 || !Array.isArray(parsed.entries)) savePersistedVocabulary(result, customPath);
    return result;
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to read vocabulary.json; leaving it untouched");
    return { customVocabulary: [], presetVocabulary: {} };
  }
}

export function savePersistedVocabulary(vocab: PersistedVocabulary, customPath?: string): void {
  const filePath = resolveVocabularyPath(customPath);
  const targetDir = dirname(filePath);
  if (!existsSync(targetDir)) {
    try { mkdirSync(targetDir, { recursive: true }); } catch {}
  }

  try {
    const tmp = `${filePath}.tmp`;
    const entries = vocab.entries && vocab.entries.length > 0
      ? vocab.entries
      : migrateVocabulary(vocab.customVocabulary || [], vocab.presetVocabulary || []);
    const derivedCustom = vocab.customVocabulary && vocab.customVocabulary.length > 0
      ? vocab.customVocabulary
      : deriveLegacyCustomVocabulary(entries);
    const derivedPreset = vocab.presetVocabulary && Object.keys(vocab.presetVocabulary).length > 0
      ? vocab.presetVocabulary
      : deriveLegacyPresetVocabulary(entries);
    const payload = {
      version: 2,
      customVocabulary: derivedCustom,
      presetVocabulary: derivedPreset,
      entries,
    };
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, filePath);
    logger.info({ vocabPath: filePath }, "Persisted custom vocabulary dictionary cleanly");
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to save vocabulary.json");
  }
}
