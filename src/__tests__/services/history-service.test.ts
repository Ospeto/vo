import { describe, test, expect } from "bun:test";
import { calculateDictationCost, getMonthlyTotalCost, addHistoryEntry, clearHistory } from "../../services/history-service.js";

describe("history-service cost audit", () => {
  test("calculateDictationCost computes accurate token costs for 3.1 Flash Lite", () => {
    // 5 seconds audio (125 tokens @ $0.25/M) + 40 char English text (14 tokens @ $1.50/M)
    const cost = calculateDictationCost(5, 40, "gemini-3.1-flash-lite");
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });

  test("calculateDictationCost handles 3.6 Flash pricing tier correctly", () => {
    const costLite = calculateDictationCost(10, 100, "gemini-3.1-flash-lite");
    const costPro = calculateDictationCost(10, 100, "gemini-3.6-flash");
    expect(costPro).toBeGreaterThan(costLite);
  });

  test("getMonthlyTotalCost sums monthly entries correctly", () => {
    clearHistory();
    addHistoryEntry("Test line 1", "VSCode", 0.00005, 5, "gemini-3.1-flash-lite");
    addHistoryEntry("Test line 2", "Terminal", 0.00008, 6, "gemini-3.1-flash-lite");

    const total = getMonthlyTotalCost();
    expect(total).toBeCloseTo(0.00013, 5);
  });
});
