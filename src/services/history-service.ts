import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync } from "node:fs";

export interface HistoryEntry {
  id: string;
  timestamp: string; // ISO string or short time
  rawTimestamp?: number;
  text: string;
  activeApp: string;
  cost?: number;
  audioDurationSec?: number;
  modelUsed?: string;
  usedPaidKey?: boolean;
}

export interface CostLedger {
  lifetimeCost: number;
  monthlyCosts: Record<string, number>;
  totalDictations: number;
}

const MAX_STORED_HISTORY = 500;
const PERSISTENT_CONFIG_DIR = join(homedir(), ".config", "pi-voice");
const LEGACY_DIR = join(homedir(), ".pi-voice");

let customHistoryDir: string | null = null;

export function setHistoryDirForTests(dir: string | null): void {
  customHistoryDir = dir;
}

function getHistoryDir(): string {
  const dir = customHistoryDir ?? PERSISTENT_CONFIG_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Migrate legacy ~/.pi-voice/history.json if present
  if (!customHistoryDir) {
    const legacyPath = join(LEGACY_DIR, "history.json");
    const targetPath = join(dir, "history.json");
    if (existsSync(legacyPath) && !existsSync(targetPath)) {
      try {
        copyFileSync(legacyPath, targetPath);
      } catch {}
    }
  }
  return dir;
}

function getHistoryPath(): string {
  return join(getHistoryDir(), "history.json");
}

function getLedgerPath(): string {
  return join(getHistoryDir(), "cost-ledger.json");
}

function getCurrentMonthKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

export function loadCostLedger(): CostLedger {
  const path = getLedgerPath();
  if (!existsSync(path)) {
    return { lifetimeCost: 0, monthlyCosts: {}, totalDictations: 0 };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      lifetimeCost: typeof parsed.lifetimeCost === "number" ? parsed.lifetimeCost : 0,
      monthlyCosts: typeof parsed.monthlyCosts === "object" && parsed.monthlyCosts ? parsed.monthlyCosts : {},
      totalDictations: typeof parsed.totalDictations === "number" ? parsed.totalDictations : 0,
    };
  } catch {
    return { lifetimeCost: 0, monthlyCosts: {}, totalDictations: 0 };
  }
}

export function recordCostInLedger(cost: number): CostLedger {
  const ledger = loadCostLedger();
  const monthKey = getCurrentMonthKey();

  ledger.lifetimeCost = Number((ledger.lifetimeCost + cost).toFixed(7));
  ledger.monthlyCosts[monthKey] = Number(((ledger.monthlyCosts[monthKey] || 0) + cost).toFixed(7));
  ledger.totalDictations = (ledger.totalDictations || 0) + 1;

  try {
    writeFileSync(getLedgerPath(), JSON.stringify(ledger, null, 2), "utf-8");
  } catch {}

  return ledger;
}

export function calculateDictationCost(
  audioDurationSec: number,
  textLength: number,
  modelUsed: string = "gemini-3.1-flash-lite",
  isEnglishOutput: boolean = true
): number {
  const audioInputTokens = Math.max(25, Math.ceil(audioDurationSec * 25));
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
  const ledger = loadCostLedger();
  const monthKey = getCurrentMonthKey();
  if (ledger.monthlyCosts[monthKey] !== undefined) {
    return Number(ledger.monthlyCosts[monthKey].toFixed(6));
  }

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

let lastAddedText = "";
let lastAddedCost = 0;
let lastAddedTime = 0;

export function addHistoryEntry(
  text: string,
  activeApp: string = "Unknown",
  cost?: number,
  audioDurationSec?: number,
  modelUsed?: string,
  usedPaidKey?: boolean
): HistoryEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return getHistoryEntries();

  const now = Date.now();
  const isBurmeseText = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(trimmed);
  const computedCost = cost !== undefined ? cost : calculateDictationCost(audioDurationSec || 5, trimmed.length, modelUsed, !isBurmeseText);

  // Time-Window Deduplication Mutex: Block duplicate text & cost entries within 3000ms
  if (trimmed === lastAddedText && Math.abs(computedCost - lastAddedCost) < 0.0000001 && now - lastAddedTime < 3000) {
    return getHistoryEntries(5);
  }

  lastAddedText = trimmed;
  lastAddedCost = computedCost;
  lastAddedTime = now;

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
    usedPaidKey: usedPaidKey ?? false,
  };

  recordCostInLedger(computedCost);

  const updated = [entry, ...current].slice(0, MAX_STORED_HISTORY);
  try {
    writeFileSync(getHistoryPath(), JSON.stringify(updated, null, 2), "utf-8");
  } catch {}

  return updated.slice(0, 5);
}

export function clearHistory(): void {
  try {
    const file = getHistoryPath();
    if (existsSync(file)) {
      unlinkSync(file);
    }
  } catch {}
}
