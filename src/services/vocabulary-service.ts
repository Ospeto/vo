import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import logger from "./logger.js";

export interface PersistedVocabulary {
  customVocabulary: string[];
  presetVocabulary: Record<string, string[]>;
}

export function resolveVocabularyPath(customPath?: string): string {
  if (customPath) return customPath;
  const dir = join(homedir(), ".config", "pi-voice");
  return join(dir, "vocabulary.json");
}

export function loadPersistedVocabulary(customPath?: string): PersistedVocabulary {
  const filePath = resolveVocabularyPath(customPath);
  const targetDir = dirname(filePath);
  if (!existsSync(targetDir)) {
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch {}
  }

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      return {
        customVocabulary: Array.isArray(parsed.customVocabulary) ? parsed.customVocabulary : [],
        presetVocabulary: typeof parsed.presetVocabulary === "object" && parsed.presetVocabulary !== null ? parsed.presetVocabulary : {},
      };
    } catch (err: any) {
      logger.error({ err: err?.message }, "Failed to read vocabulary.json");
    }
  }

  return { customVocabulary: [], presetVocabulary: {} };
}

export function savePersistedVocabulary(vocab: PersistedVocabulary, customPath?: string): void {
  const filePath = resolveVocabularyPath(customPath);
  const targetDir = dirname(filePath);
  if (!existsSync(targetDir)) {
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch {}
  }

  try {
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(vocab, null, 2), "utf-8");
    renameSync(tmp, filePath);
    logger.info({ vocabPath: filePath }, "Persisted custom vocabulary dictionary cleanly");
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to save vocabulary.json");
  }
}
