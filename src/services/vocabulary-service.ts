import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { DictionaryEntry } from "../shared/types.js";
import logger from "./logger.js";

export interface PersistedVocabulary {
  version?: 2;
  /** Legacy fields remain as a lossless compatibility mirror. */
  customVocabulary: string[];
  presetVocabulary: Record<string, string[]>;
  entries?: DictionaryEntry[];
}

const TRUSTED_SEEDS: Array<[string, string[]]> = [
  ["MAS 141", ["မက်စ် ၁၄၁", "မက်စ်၁၄၁", "မက်စ်\t၁၄၁", "မက်စ်  ၁၄၁"]],
  ["MAS 142", ["မက်စ် ၁၄၂", "မက်စ်၁၄၂", "မက်စ်\t၁၄၂", "မက်စ်  ၁၄၂"]],
  ["MAS 143", ["မက်စ် ၁၄၃", "မက်စ်၁၄၃", "မက်စ်\t၁၄၃", "မက်စ်  ၁၄၃"]],
  ["SarYayKaung", ["စာရေးကောင်း", "စာရေး ကောင်း", "စာရေး\tကောင်း", "စာရေး  ကောင်း", "စာရေးကောင်"]],
  ["Ospeto", ["ဩစပေတို", "အိုစပေတို"]],
  ["TBH", ["တီဘီအိတ်ချ်", "တီဘီအိတ်"]],
  ["Engram", ["အင်ဂရမ်", "အန်ဂရမ်"]],
];

export function resolveVocabularyPath(customPath?: string): string {
  if (customPath) return customPath;
  return join(homedir(), ".config", "pi-voice", "vocabulary.json");
}

function stableId(phrase: string, aliases: string[]): string {
  return `dict-${createHash("sha256").update(`${phrase}\n${aliases.join("\n")}`).digest("hex").slice(0, 16)}`;
}

export function dictionaryEntryFromTerm(raw: string): DictionaryEntry | null {
  const value = raw.trim();
  if (!value) return null;
  // Preserve the old human-readable mapping forms while making both sides searchable.
  const mapping = value.match(/^(.+?)\s+-\s+(.+)$/);
  if (mapping) {
    const left = mapping[1]!.trim();
    const right = mapping[2]!.trim();
    return { id: stableId(right, [left, right]), phrase: right, spokenAliases: [left, right], enabled: true };
  }
  const parenthesized = value.match(/^(.+?)\s+\((.+)\)$/);
  if (parenthesized) {
    const phrase = parenthesized[1]!.trim();
    const alias = parenthesized[2]!.trim();
    return { id: stableId(phrase, [alias, phrase]), phrase, spokenAliases: [alias, phrase], enabled: true };
  }
  return { id: stableId(value, [value]), phrase: value, spokenAliases: [value], enabled: true };
}

function seededEntries(): DictionaryEntry[] {
  return TRUSTED_SEEDS.map(([phrase, aliases]) => ({ id: stableId(phrase, aliases), phrase, spokenAliases: aliases, enabled: true, legacyWhitespace: true }));
}

function mergeEntries(entries: DictionaryEntry[]): DictionaryEntry[] {
  const merged: DictionaryEntry[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw.phrase !== "string" || !Array.isArray(raw.spokenAliases)) continue;
    const phrase = raw.phrase.trim();
    const aliases = raw.spokenAliases.filter((alias): alias is string => typeof alias === "string").map((alias) => alias.trim()).filter(Boolean);
    if (!phrase) continue;
    const existing = merged.find((entry) => entry.phrase === phrase);
    if (existing) {
      existing.spokenAliases = Array.from(new Set([...existing.spokenAliases, ...aliases, phrase]));
    } else {
      merged.push({ id: raw.id || stableId(phrase, aliases), phrase, spokenAliases: Array.from(new Set([...aliases, phrase])), enabled: raw.enabled !== false, ...(raw.legacyWhitespace ? { legacyWhitespace: true } : {}) });
    }
  }
  return merged;
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

export function migrateVocabulary(customVocabulary: string[], presetVocabulary: Record<string, string[]>, existingEntries: DictionaryEntry[] = [], userDictionary: string[] = []): DictionaryEntry[] {
  const legacy = [...customVocabulary, ...Object.values(presetVocabulary).flat(), ...userDictionary];
  return mergeEntries([...seededEntries(), ...existingEntries, ...legacy.map(dictionaryEntryFromTerm).filter((entry): entry is DictionaryEntry => Boolean(entry))]);
}

export function loadPersistedVocabulary(customPath?: string, customDictionaryPath?: string): PersistedVocabulary {
  const filePath = resolveVocabularyPath(customPath);
  const targetDir = dirname(filePath);
  if (!existsSync(targetDir)) {
    try { mkdirSync(targetDir, { recursive: true }); } catch {}
  }

  if (!existsSync(filePath)) {
    const migrated = migrateVocabulary([], {}, [], readUserDictionary(customDictionaryPath || join(homedir(), ".pi", "dictionary.txt")));
    return { version: 2 as const, customVocabulary: [], presetVocabulary: {}, entries: migrated };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!validLegacyShape(parsed)) {
      logger.warn({ vocabPath: filePath }, "Vocabulary file has malformed fields; leaving it untouched");
      return { customVocabulary: [], presetVocabulary: {} };
    }
    const customVocabulary = Array.isArray(parsed.customVocabulary) ? parsed.customVocabulary : [];
    const presetVocabulary = parsed.presetVocabulary && typeof parsed.presetVocabulary === "object" ? parsed.presetVocabulary : {};
    const entries = migrateVocabulary(customVocabulary, presetVocabulary, Array.isArray(parsed.entries) ? parsed.entries : [], parsed.entries ? [] : readUserDictionary(customDictionaryPath || join(homedir(), ".pi", "dictionary.txt")));
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
    const payload = { version: 2, customVocabulary: vocab.customVocabulary || [], presetVocabulary: vocab.presetVocabulary || {}, entries: vocab.entries || [] };
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, filePath);
    logger.info({ vocabPath: filePath }, "Persisted custom vocabulary dictionary cleanly");
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to save vocabulary.json");
  }
}
