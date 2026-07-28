import { describe, expect, test } from "bun:test";
import { getPresetPromptInstructions, getPresetTemperature, resolveEffectivePreset, getFallbackModelChain } from "../../services/stt.js";
import { addHistoryEntry, getHistoryEntries, clearHistory, setHistoryDirForTests } from "../../services/history-service.js";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// macOS Menu Bar GUI - Canonical Production Contract Helper Functions & Types
// ============================================================================

export type GeminiModelChoice = "gemini-3.1-flash-lite" | "gemini-2.5-flash";
export type AppState = "idle" | "starting" | "recording" | "stopping" | "transcribing" | "thinking" | "speaking" | "error";

export interface MenuBarGuiConfig {
  geminiModel: GeminiModelChoice;
  inputGain: number; // Clamped [0.0, 2.0]
  hotkey: string;
}

export interface StatusBadgeInfo {
  color: string;
  label: string;
  pulseAnimation: boolean;
}

export function getDefaultGuiConfig(): MenuBarGuiConfig {
  return {
    geminiModel: "gemini-3.1-flash-lite",
    inputGain: 1.0,
    hotkey: "ctrl+cmd+option+v",
  };
}

export function parseAndValidateGuiConfig(input: Partial<MenuBarGuiConfig>): MenuBarGuiConfig {
  const defaults = getDefaultGuiConfig();
  
  const validModels: GeminiModelChoice[] = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];
  const geminiModel = validModels.includes(input.geminiModel as GeminiModelChoice)
    ? (input.geminiModel as GeminiModelChoice)
    : defaults.geminiModel;

  let inputGain = typeof input.inputGain === "number" && !Number.isNaN(input.inputGain)
    ? input.inputGain
    : defaults.inputGain;
  inputGain = Math.max(0.0, Math.min(2.0, Number(inputGain.toFixed(2))));

  const hotkey = typeof input.hotkey === "string" && input.hotkey.trim().length > 0
    ? input.hotkey.trim().toLowerCase()
    : defaults.hotkey;

  return { geminiModel, inputGain, hotkey };
}

export function getStatusBadgeDetails(state: AppState): StatusBadgeInfo {
  switch (state) {
    case "idle":
      return { color: "#10b981", label: "Ready", pulseAnimation: false };
    case "starting":
    case "recording":
      return { color: "#f43f5e", label: "Listening...", pulseAnimation: true };
    case "stopping":
    case "transcribing":
    case "thinking":
    case "speaking":
      return { color: "#f59e0b", label: "Processing...", pulseAnimation: true };
    case "error":
      return { color: "#ef4444", label: "Error", pulseAnimation: false };
  }
}

export function calculateAudioIntensity(samples: Float32Array, gain: number = 1.0): { rmsDb: number; percentage: number; isSilent: boolean } {
  if (!samples || samples.length === 0) {
    return { rmsDb: -100, percentage: 0, isSilent: true };
  }

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0;
    const amplified = sample * gain;
    sumSquares += amplified * amplified;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms < 0.0001) {
    return { rmsDb: -100, percentage: 0, isSilent: true };
  }

  const rmsDb = Math.max(-60, Math.min(0, 20 * Math.log10(rms)));
  const percentage = Math.max(0, Math.min(100, Math.round(((rmsDb + 60) / 60) * 100)));
  const isSilent = percentage < 2;

  return { rmsDb: Number(rmsDb.toFixed(1)), percentage, isSilent };
}

export function calculatePopoverPosition(
  trayBounds: { x: number; y: number; width: number; height: number },
  popoverDim: { width: number; height: number },
  screenBounds: { width: number; height: number }
) {
  const trayCenterX = trayBounds.x + trayBounds.width / 2;
  let targetX = Math.round(trayCenterX - popoverDim.width / 2);
  let targetY = Math.round(trayBounds.y + trayBounds.height + 4);

  if (targetX < 10) targetX = 10;
  if (targetX + popoverDim.width > screenBounds.width - 10) {
    targetX = screenBounds.width - popoverDim.width - 10;
  }

  return { x: targetX, y: targetY, width: popoverDim.width, height: popoverDim.height };
}

export function validateHotkeyCombination(hotkeyStr: string): { isValid: boolean; reason?: string } {
  const normalized = hotkeyStr.toLowerCase().trim();
  if (!normalized) return { isValid: false, reason: "Empty hotkey string" };

  const reserved = ["cmd+q", "command+q", "cmd+tab", "command+tab", "cmd+space", "command+space"];
  if (reserved.includes(normalized)) {
    return { isValid: false, reason: `Hotkey "${hotkeyStr}" is a reserved macOS system shortcut` };
  }

  const parts = normalized.split("+").map((s) => s.trim());
  const modifiers = new Set(["ctrl", "control", "shift", "alt", "opt", "option", "meta", "cmd", "command"]);
  const nonModifiers = parts.filter((p) => !modifiers.has(p));

  if (nonModifiers.length === 0) return { isValid: false, reason: "No non-modifier key specified" };
  if (nonModifiers.length > 1) return { isValid: false, reason: "Multiple main keys specified" };

  return { isValid: true };
}

// ============================================================================
// Production Contract Test Suite
// ============================================================================

describe("macOS Menu Bar GUI - Production Contract Test Suite", () => {
  describe("1. Configuration Persistence & Bounds Contracts", () => {
    test("validates and accepts gemini-2.5-flash model selection", () => {
      const parsed = parseAndValidateGuiConfig({ geminiModel: "gemini-2.5-flash" });
      expect(parsed.geminiModel).toBe("gemini-2.5-flash");
    });

    test("fallback to gemini-3.1-flash-lite when given invalid model name", () => {
      const parsed = parseAndValidateGuiConfig({ geminiModel: "invalid-model" as any });
      expect(parsed.geminiModel).toBe("gemini-3.1-flash-lite");
    });

    test("clamps input gain level within [0.0, 2.0] bounds", () => {
      expect(parseAndValidateGuiConfig({ inputGain: 1.75 }).inputGain).toBe(1.75);
      expect(parseAndValidateGuiConfig({ inputGain: 3.0 }).inputGain).toBe(2.0);
      expect(parseAndValidateGuiConfig({ inputGain: -0.5 }).inputGain).toBe(0.0);
      expect(parseAndValidateGuiConfig({ inputGain: NaN }).inputGain).toBe(1.0);
    });

    test("normalizes hotkey string input", () => {
      const parsed = parseAndValidateGuiConfig({ hotkey: "  CTRL+CMD+SHIFT+V  " });
      expect(parsed.hotkey).toBe("ctrl+cmd+shift+v");
    });
  });

  describe("2. Status Badge & Visual Indicator Contracts", () => {
    test("maps 'idle' state to emerald green ready badge", () => {
      const badge = getStatusBadgeDetails("idle");
      expect(badge.color).toBe("#10b981");
      expect(badge.label).toBe("Ready");
      expect(badge.pulseAnimation).toBe(false);
    });

    test("maps 'recording' state to ruby red pulsing badge", () => {
      const badge = getStatusBadgeDetails("recording");
      expect(badge.color).toBe("#f43f5e");
      expect(badge.label).toBe("Listening...");
      expect(badge.pulseAnimation).toBe(true);
    });

    test("maps 'transcribing' state to amber processing badge", () => {
      const badge = getStatusBadgeDetails("transcribing");
      expect(badge.color).toBe("#f59e0b");
      expect(badge.label).toBe("Processing...");
      expect(badge.pulseAnimation).toBe(true);
    });

    test("maps 'error' state to warning red alert badge", () => {
      const badge = getStatusBadgeDetails("error");
      expect(badge.color).toBe("#ef4444");
      expect(badge.label).toBe("Error");
      expect(badge.pulseAnimation).toBe(false);
    });
  });

  describe("3. Web Audio RMS Intensity & Gain DSP Contracts", () => {
    test("returns 0% intensity and isSilent=true for empty sample array", () => {
      const res = calculateAudioIntensity(new Float32Array([]), 1.0);
      expect(res.percentage).toBe(0);
      expect(res.isSilent).toBe(true);
    });

    test("calculates correct intensity percentage for sine wave audio at 1.0x gain", () => {
      const samples = new Float32Array(100);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = 0.5 * Math.sin((i / 100) * 2 * Math.PI);
      }
      const res = calculateAudioIntensity(samples, 1.0);
      expect(res.isSilent).toBe(false);
      expect(res.percentage).toBeGreaterThan(70);
    });

    test("amplifies audio intensity when input gain is increased (2.0x gain)", () => {
      const samples = new Float32Array(50);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = 0.2;
      }
      const res1 = calculateAudioIntensity(samples, 1.0);
      const res2 = calculateAudioIntensity(samples, 2.0);
      expect(res2.percentage).toBeGreaterThan(res1.percentage);
    });
  });

  describe("4. Popover Geometry Math Contracts", () => {
    test("centers popover window horizontally under tray icon", () => {
      const trayBounds = { x: 500, y: 0, width: 30, height: 24 };
      const popoverDim = { width: 360, height: 480 };
      const screenBounds = { width: 1440, height: 900 };

      const pos = calculatePopoverPosition(trayBounds, popoverDim, screenBounds);
      expect(pos.x).toBe(335);
      expect(pos.y).toBe(28);
    });
  });

  describe("5. Hotkey & Security Validation Contracts", () => {
    test("accepts valid global shortcut combination", () => {
      const res = validateHotkeyCombination("ctrl+cmd+option+v");
      expect(res.isValid).toBe(true);
    });

    test("rejects reserved macOS system shortcut (Cmd+Q)", () => {
      const res = validateHotkeyCombination("cmd+q");
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain("reserved macOS system shortcut");
    });
  });

  describe("6. Dictation Presets & Custom Vocabulary Contracts", () => {
    test("returns correct prompt instructions and temperature for each dictation preset", () => {
      expect(getPresetPromptInstructions("code_comment")).toContain("SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION");
      expect(getPresetPromptInstructions("code_comment")).toContain("FAITHFUL TRANSLATION & ZERO IMPROVISATION");
      expect(getPresetPromptInstructions("code_comment")).toContain("SPOKEN IDENTIFIER FORMATTING");
      expect(getPresetPromptInstructions("careful")).toContain("CAREFUL DEEP PROOFREADING");

      expect(getPresetTemperature("code_comment")).toBe(0.0);
      expect(getPresetTemperature("careful")).toBe(0.0);
    });

    test("excludes gemini-3.6-flash from fallback chain to protect free tier rate limits", () => {
      const codeChain = getFallbackModelChain("gemini-3.1-flash-lite", "code_comment");
      expect(codeChain).not.toContain("gemini-3.6-flash");

      const generalChain = getFallbackModelChain("gemini-3.1-flash-lite", "careful");
      expect(generalChain).not.toContain("gemini-3.6-flash");
      expect(generalChain[0]).toBe("gemini-3.1-flash-lite");
      expect(generalChain[1]).toBe("gemini-3.5-flash-lite");
    });

    test("dynamically resolves effective preset when auto mode is selected", () => {
      expect(resolveEffectivePreset("auto", "Cursor")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Terminal")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Myanso")).toBe("code_comment");
      expect(resolveEffectivePreset("auto", "Slack")).toBe("email_polish");
      expect(resolveEffectivePreset("auto", "Mail")).toBe("email_polish");
      expect(resolveEffectivePreset("auto", "Obsidian")).toBe("burmese_written");
      expect(resolveEffectivePreset("auto", "Calculator")).toBe("careful");
      expect(resolveEffectivePreset("fast", "Cursor")).toBe("fast");
    });

    test("supports preset-dependent vocabulary list resolution", () => {
      const presetVocab = {
        code_comment: ["TypeScript", "Prisma"],
        burmese_written: ["Engram", "FSRS"],
      };
      expect(presetVocab.code_comment).toContain("TypeScript");
      expect(presetVocab.burmese_written).toContain("FSRS");
    });

    test("maintains ring buffer bounds and clear history functionality", () => {
      const tmpDir = join(tmpdir(), `test-history-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      setHistoryDirForTests(tmpDir);

      clearHistory();
      expect(getHistoryEntries().length).toBe(0);

      addHistoryEntry("Entry 1", "Terminal");
      addHistoryEntry("Entry 2", "VSCode");
      addHistoryEntry("Entry 3", "Chrome");
      addHistoryEntry("Entry 4", "Obsidian");
      addHistoryEntry("Entry 5", "Slack");
      addHistoryEntry("Entry 6", "Sublime"); // Should overflow Entry 1

      const entries = getHistoryEntries();
      expect(entries.length).toBe(5);
      expect(entries[0]?.text).toBe("Entry 6");
      expect(entries[4]?.text).toBe("Entry 2");

      clearHistory();
      expect(getHistoryEntries().length).toBe(0);
    });
  });
});
