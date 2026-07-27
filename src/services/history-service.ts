import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";

export interface HistoryEntry {
  id: string;
  timestamp: string; // ISO string or short time
  rawTimestamp?: number;
  text: string;
  activeApp: string;
  cost?: number;
  audioDurationSec?: number;
  modelUsed?: string;
}

const MAX_STORED_HISTORY = 200;
const DEFAULT_DIR = join(homedir(), ".pi-voice");
let customHistoryDir: string | null = null;

export function setHistoryDirForTests(dir: string | null): void {
  customHistoryDir = dir;
}

function getHistoryPath(): string {
  const dir = customHistoryDir ?? DEFAULT_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, "history.json");
}

export function calculateDictationCost(
  audioDurationSec: number,
  textLength: number,
  modelUsed: string = "gemini-3.1-flash-lite",
  isEnglishOutput: boolean = true
): number {
  // Input: Audio is ~25 tokens/sec
  const audioInputTokens = Math.max(25, Math.ceil(audioDurationSec * 25));
  // Output: ~0.35 tokens/char for English text, ~0.65 for Burmese script
  const charTokenRatio = isEnglishOutput ? 0.35 : 0.65;
  const textOutputTokens = Math.ceil(textLength * charTokenRatio);

  let inputRatePerM = 0.25;
  let outputRatePerM = 1.50;

  if (modelUsed.includes("3.6-flash")) {
    inputRatePerM = 1.50;
    outputRatePerM = 7.50;
  } else if (modelUsed.includes("3.5-flash") || modelUsed.includes("2.5-flash")) {
    inputRatePerM = 0.30;
    outputRatePerM = 2.50;
  } else if (modelUsed.includes("2.5-pro") || modelUsed.includes("pro")) {
    inputRatePerM = 2.00;
    outputRatePerM = 12.00;
  }

  const inputCost = (audioInputTokens / 1_000_000) * inputRatePerM;
  const outputCost = (textOutputTokens / 1_000_000) * outputRatePerM;
  const totalCost = inputCost + outputCost;

  return Number(totalCost.toFixed(7));
}

export function getHistoryEntries(limit: number = 5): HistoryEntry[] {
  const file = getHistoryPath();
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return limit > 0 ? parsed.slice(0, limit) : parsed;
  } catch {
    return [];
  }
}

export function getMonthlyTotalCost(): number {
  const entries = getHistoryEntries(0);
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let total = 0;
  for (const entry of entries) {
    const entryDate = entry.rawTimestamp ? new Date(entry.rawTimestamp) : new Date();
    if (entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear) {
      total += entry.cost || 0;
    }
  }
  return Number(total.toFixed(6));
}

export function addHistoryEntry(
  text: string,
  activeApp: string = "Unknown",
  cost?: number,
  audioDurationSec?: number,
  modelUsed?: string
): HistoryEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return getHistoryEntries();

  const now = Date.now();
  const computedCost = cost !== undefined ? cost : calculateDictationCost(audioDurationSec || 5, trimmed.length, modelUsed);

  const current = getHistoryEntries(0);
  const entry: HistoryEntry = {
    id: `hist-${now}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    rawTimestamp: now,
    text: trimmed,
    activeApp: activeApp || "Unknown",
    cost: computedCost,
    audioDurationSec: audioDurationSec || 5,
    modelUsed: modelUsed || "gemini-3.1-flash-lite",
  };

  const updated = [entry, ...current].slice(0, MAX_STORED_HISTORY);
  try {
    writeFileSync(getHistoryPath(), JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    // Best effort
  }
  return updated.slice(0, 5);
}

export function clearHistory(): void {
  try {
    const file = getHistoryPath();
    if (existsSync(file)) {
      unlinkSync(file);
    }
  } catch {
    // Best effort
  }
}
