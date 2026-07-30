import fs from "node:fs";
import { join } from "node:path";
import { mock } from "bun:test";

mock.module("../../services/logger.js", () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
mock.module("../../services/vocabulary-service.js", () => ({
  loadPersistedVocabulary: () => ({ customVocabulary: [], presetVocabulary: {}, entries: [] }),
  savePersistedVocabulary: () => {},
  migrateVocabulary: (_custom: string[], _preset: Record<string, string[]>, entries: unknown[] = []) => entries,
  backfillLegacyWhitespace: (entries: unknown[]) => entries,
}));

const [id, root] = process.argv.slice(2);
if (!id || !root) throw new Error("usage: config-recovery-worker <A|B> <root>");

const markers = join(root, "markers");
fs.writeFileSync(join(markers, `ready-${id}`), "");
const other = join(markers, `ready-${id === "A" ? "B" : "A"}`);
while (!fs.existsSync(other)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);

const { updateConfig } = await import("../../services/config.js");
const result = updateConfig(
  join(root, "project"),
  id === "A" ? { inputGain: 1.1 } : { targetLanguage: "French" },
);
console.log(JSON.stringify({ id, inputGain: result.inputGain, targetLanguage: result.targetLanguage }));
