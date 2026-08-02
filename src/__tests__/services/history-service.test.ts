import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import {
  calculateDictationCost,
  getMonthlyTotalCost,
  getHistoryEntries,
  addHistoryEntry,
  clearHistory,
  setHistoryDirForTests,
  loadCostLedger,
} from "../../services/history-service.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "pi-voice-hist-test-"));
  setHistoryDirForTests(testDir);
});

afterEach(() => {
  setHistoryDirForTests(null);
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("history-service cost audit", () => {
  test("calculateDictationCost computes accurate token costs for 3.1 Flash Lite", () => {
    const cost = calculateDictationCost(5, 40, "gemini-3.1-flash-lite");
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });

  test("calculateDictationCost handles 3.6 Flash pricing tier correctly", () => {
    const costLite = calculateDictationCost(10, 100, "gemini-3.1-flash-lite");
    const costPro = calculateDictationCost(10, 100, "gemini-3.6-flash");
    expect(costPro).toBeGreaterThan(costLite);
  });

  test("calculateDictationCost uses Burmese token ratio (0.65) when isEnglishOutput is false", () => {
    const englishCost = calculateDictationCost(5, 100, "gemini-3.1-flash-lite", true);
    const burmeseCost = calculateDictationCost(5, 100, "gemini-3.1-flash-lite", false);
    expect(burmeseCost).toBeGreaterThan(englishCost);
  });

  test("addHistoryEntry detects Burmese script in output text and computes Burmese cost ratio", () => {
    clearHistory();
    const text = "မြန်မာစာ စမ်းသပ်ချက်";
    addHistoryEntry(text, "Obsidian", undefined, 5, "gemini-3.1-flash-lite");
    const ledger = loadCostLedger();
    const expectedCost = calculateDictationCost(5, text.length, "gemini-3.1-flash-lite", false);
    expect(ledger.lifetimeCost).toBeCloseTo(expectedCost, 5);
  });

  test("clearHistory replaces symlink without overwriting its target", () => {
    const historyPath = join(testDir, "history.json");
    const targetPath = join(testDir, "outside.json");
    writeFileSync(targetPath, "keep me");
    symlinkSync(targetPath, historyPath);

    clearHistory();

    expect(readFileSync(targetPath, "utf8")).toBe("keep me");
    expect(getHistoryEntries()).toEqual([]);
  });

  test("getMonthlyTotalCost sums monthly entries and records in cost-ledger.json", () => {
    clearHistory();
    addHistoryEntry("Test line 1", "VSCode", 0.00005, 5, "gemini-3.1-flash-lite");
    addHistoryEntry("Test line 2", "Terminal", 0.00008, 6, "gemini-3.1-flash-lite");

    const total = getMonthlyTotalCost();
    expect(total).toBeCloseTo(0.00013, 5);

    const ledger = loadCostLedger();
    expect(ledger.lifetimeCost).toBeCloseTo(0.00013, 5);
    expect(ledger.totalDictations).toBe(2);
  });

  test("deduplicates identical cost entries submitted within 3000ms window", () => {
    clearHistory();
    addHistoryEntry("Duplicate test line", "VSCode", 0.00005, 5, "gemini-3.1-flash-lite");
    // Submitting duplicate text & cost immediately
    addHistoryEntry("Duplicate test line", "VSCode", 0.00005, 5, "gemini-3.1-flash-lite");

    const ledger = loadCostLedger();
    expect(ledger.totalDictations).toBe(1);
    expect(ledger.lifetimeCost).toBeCloseTo(0.00005, 5);
  });
});
