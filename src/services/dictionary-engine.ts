import type { DictionaryEntry } from "../shared/types.js";

export interface DictionaryValidationError {
  alias: string;
  message: string;
  entryIds: string[];
}

interface Candidate {
  alias: string;
  phrase: string;
  entryId: string;
  order: number;
  boundary: boolean;
  legacyWhitespace: boolean;
}

const LATIN_BOUNDARY = "A-Za-z0-9_";

function normalizeAlias(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

function normalizeLegacyAlias(value: string): string {
  return normalizeAlias(value).replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Stable, local post-transcription replacement. It never reparses its output. */
export class DictionaryEngine {
  private readonly candidates: Candidate[];
  private readonly matcher: RegExp | null;

  constructor(entries: DictionaryEntry[]) {
    const candidates: Candidate[] = [];
    entries
      .filter((entry) => entry.enabled)
      .forEach((entry, entryIndex) => {
        const aliases = [entry.phrase, ...entry.spokenAliases];
        aliases.forEach((alias, aliasIndex) => {
          const value = alias.trim();
          if (!value) return;
          candidates.push({
            alias: value,
            phrase: entry.phrase,
            entryId: entry.id,
            order: entryIndex * 100000 + aliasIndex,
            boundary: /[A-Za-z0-9_]/.test(value),
            legacyWhitespace: entry.legacyWhitespace === true,
          });
        });
      });

    candidates.sort((a, b) => b.alias.length - a.alias.length || a.order - b.order);
    this.candidates = candidates;
    if (candidates.length === 0) {
      this.matcher = null;
      return;
    }

    const alternatives = candidates.map((candidate) => {
      const escaped = (candidate.legacyWhitespace || candidate.alias.includes(" ") || candidate.alias.includes("-"))
        ? candidate.alias.split(/[\s\-]+/).filter(Boolean).map(escapeRegExp).join("[\\s\\-]*")
        : escapeRegExp(candidate.alias);
      return candidate.boundary
        ? `(?<![${LATIN_BOUNDARY}])${escaped}(?![${LATIN_BOUNDARY}])`
        : escaped;
    });
    this.matcher = new RegExp(alternatives.join("|"), "giu");
  }

  process(text: string): string {
    if (!text || !this.matcher) return text;
    return text.replace(this.matcher, (match) => {
      const matchNorm = normalizeAlias(match).replace(/[\s\-]+/g, "");
      const candidate = this.candidates.find((item) => {
        const itemNorm = normalizeAlias(item.alias).replace(/[\s\-]+/g, "");
        return itemNorm === matchNorm || (item.legacyWhitespace
          ? normalizeLegacyAlias(item.alias) === normalizeLegacyAlias(match)
          : normalizeAlias(item.alias) === normalizeAlias(match));
      });
      return candidate?.phrase ?? match;
    });
  }
}

export function validateDictionaryEntries(entries: DictionaryEntry[]): DictionaryValidationError[] {
  const aliases: Array<{ phrase: string; ids: string[]; original: string; key: string; legacyWhitespace: boolean }> = [];
  const errors: DictionaryValidationError[] = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    for (const rawAlias of [entry.phrase, ...entry.spokenAliases]) {
      const alias = rawAlias.trim();
      if (!alias) continue;
      const key = normalizeAlias(alias);
      const compactKey = key.replace(/\s+/g, "");
      const existing = aliases.find((item) => {
        return item.key === key || ((item.legacyWhitespace || entry.legacyWhitespace === true) && item.key.replace(/\s+/g, "") === compactKey);
      });
      if (!existing) {
        aliases.push({ phrase: entry.phrase, ids: [entry.id], original: alias, key, legacyWhitespace: entry.legacyWhitespace === true });
      } else if (normalizeAlias(existing.phrase) !== normalizeAlias(entry.phrase)) {
        const ids = Array.from(new Set([...existing.ids, entry.id]));
        if (!errors.some((error) => error.alias === existing.original)) {
          errors.push({ alias: existing.original, message: "Alias maps to more than one Write as phrase", entryIds: ids });
        } else {
          const error = errors.find((item) => item.alias === existing.original);
          if (error) error.entryIds = ids;
        }
      } else if (!existing.ids.includes(entry.id)) {
        existing.ids.push(entry.id);
      }
    }
  }
  return errors;
}

export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  return new DictionaryEngine(entries).process(text);
}
