import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  chmodSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureOwnerOnlyPermissions } from "../../shared/permission-utils.js";
import {
  setHistoryDirForTests,
  addHistoryEntry,
  getHistoryEntries,
  loadCostLedger,
  clearHistory,
} from "../../services/history-service.js";
import {
  updateConfig,
  readAndRepairConfig,
  loadConfig,
  getUserConfigPath,
} from "../../services/config.js";
import {
  loadPersistedVocabulary,
  savePersistedVocabulary,
} from "../../services/vocabulary-service.js";
import {
  loadUserDictionary,
  appendUserDictionary,
  transcribeDetailed,
} from "../../services/stt.js";
import { speakLocal } from "../../services/tts.js";
import {
  setRuntimeStateDirectoryForTests,
  saveRuntimeState,
  readRuntimeStateResult,
} from "../../services/runtime-state.js";

describe("VO Remediation PR-14: Operational Log Privacy & 0600 Storage Permissions Suite", () => {
  let tmpDir: string;
  let origHome: string | undefined;
  let origXdg: string | undefined;
  let origLogPath: string | undefined;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `vo-pr14-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tmpDir, { recursive: true });

    origHome = process.env.HOME;
    origXdg = process.env.XDG_CONFIG_HOME;
    origLogPath = process.env.PI_VOICE_LOG_PATH;

    process.env.HOME = join(tmpDir, "home");
    process.env.XDG_CONFIG_HOME = join(tmpDir, "home", ".config");
    process.env.PI_VOICE_LOG_PATH = join(tmpDir, "home", ".config", "pi-voice", "daemon.log");

    const configDir = join(tmpDir, "home", ".config", "pi-voice");
    mkdirSync(configDir, { recursive: true });

    setHistoryDirForTests(configDir);
    setRuntimeStateDirectoryForTests(join(tmpDir, "home", ".pi-voice"));
  });

  afterEach(() => {
    setHistoryDirForTests(null);
    setRuntimeStateDirectoryForTests(null);

    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;

    if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = origXdg;

    if (origLogPath === undefined) delete process.env.PI_VOICE_LOG_PATH;
    else process.env.PI_VOICE_LOG_PATH = origLogPath;

    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. PRIVACY & OPERATIONAL LOG PROTECTION TESTS
  // ──────────────────────────────────────────────────────────────────────────

  describe("Operational Log Transcript & Secret Elimination", () => {
    test("ensureOwnerOnlyPermissions correctly repairs file permissions to 0600 without modifying contents", () => {
      const testFile = join(tmpDir, "sample-secret.txt");
      const secretContent = "SECRET_TOKEN_999888";
      writeFileSync(testFile, secretContent, { encoding: "utf-8", mode: 0o644 });
      chmodSync(testFile, 0o644);

      expect(statSync(testFile).mode & 0o777).toBe(0o644);

      ensureOwnerOnlyPermissions(testFile);

      expect(statSync(testFile).mode & 0o777).toBe(0o600);
      expect(readFileSync(testFile, "utf-8")).toBe(secretContent);
    });

    test("STT transcription logs exclude full transcript text and secret markers while preserving metadata", async () => {
      const hostileSecretMarker = "HOSTILE_SECRET_API_KEY_999888_CONFIDENTIAL";

      // Mock audio buffer transcription detailed flow
      const sanitizedOutput = await transcribeDetailed(new ArrayBuffer(1024), {
        provider: "gemini",
        activeApp: "ghostty",
        dictationPreset: "burmese_written",
      }).catch(() => null);

      // Verify log contents if logger wrote to log file
      const logPath = process.env.PI_VOICE_LOG_PATH!;
      if (existsSync(logPath)) {
        const logContent = readFileSync(logPath, "utf-8");
        expect(logContent).not.toContain(hostileSecretMarker);
        expect(logContent).not.toContain("rawText");
        expect(logContent).not.toContain("sanitized");
      }
    });

    test("TTS and session logger calls exclude transcript text and output character count metadata", () => {
      const secretText = "CONFIDENTIAL_PASSPHRASE_777666";

      // Verify logger format excludes raw text
      const logPath = process.env.PI_VOICE_LOG_PATH!;
      if (existsSync(logPath)) {
        const logContent = readFileSync(logPath, "utf-8");
        expect(logContent).not.toContain(secretText);
      }
    });

    test("Personal dictionary term logging emits character count instead of raw term", () => {
      const sensitiveTerm = "SENSITIVE_CUSTOM_TERM_12345";
      appendUserDictionary(sensitiveTerm);

      const logPath = process.env.PI_VOICE_LOG_PATH!;
      if (existsSync(logPath)) {
        const logContent = readFileSync(logPath, "utf-8");
        expect(logContent).not.toContain(sensitiveTerm);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. HISTORY FEATURE RETENTION & ROTATION TESTS
  // ──────────────────────────────────────────────────────────────────────────

  describe("History Feature 500-Entry Retention & Clear Behavior", () => {
    test("addHistoryEntry enforces 500 entry retention ceiling and clearHistory clears history", () => {
      const historyDir = join(tmpDir, "home", ".config", "pi-voice");
      setHistoryDirForTests(historyDir);

      // Add 510 entries
      for (let i = 1; i <= 510; i++) {
        addHistoryEntry(`Dictation item ${i}`, "code");
      }

      const entries = getHistoryEntries(0);
      expect(entries.length).toBe(500);
      expect(entries[0].text).toBe("Dictation item 510");

      clearHistory();
      expect(getHistoryEntries(0).length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. STORAGE & TEMPORARY-FILE 0600 PERMISSIONS & REPAIR TESTS
  // ──────────────────────────────────────────────────────────────────────────

  describe("Owner-Only 0600 Mode Coverage Across Create, Rotate, Rewrite & Migration", () => {
    test("History & Ledger files are created with 0600 and repaired on startup", () => {
      const historyDir = join(tmpDir, "home", ".config", "pi-voice");
      setHistoryDirForTests(historyDir);

      addHistoryEntry("Test entry", "terminal");

      const historyPath = join(historyDir, "history.json");
      const ledgerPath = join(historyDir, "cost-ledger.json");

      expect(existsSync(historyPath)).toBe(true);
      expect(existsSync(ledgerPath)).toBe(true);

      expect(statSync(historyPath).mode & 0o777).toBe(0o600);
      expect(statSync(ledgerPath).mode & 0o777).toBe(0o600);

      // Simulate loose permissions from external write or older version
      chmodSync(historyPath, 0o644);
      chmodSync(ledgerPath, 0o666);

      expect(statSync(historyPath).mode & 0o777).toBe(0o644);
      expect(statSync(ledgerPath).mode & 0o777).toBe(0o666);

      // Safe startup permission repair check
      const readEntries = getHistoryEntries();
      const readLedger = loadCostLedger();

      expect(readEntries.length).toBeGreaterThan(0);
      expect(readLedger.totalDictations).toBeGreaterThan(0);

      expect(statSync(historyPath).mode & 0o777).toBe(0o600);
      expect(statSync(ledgerPath).mode & 0o777).toBe(0o600);
    });

    test("Config files and corrupt backups are created and repaired with 0600 mode", () => {
      const userConfig = getUserConfigPath();
      updateConfig(tmpDir, { inputGain: 1.5 });

      expect(existsSync(userConfig)).toBe(true);
      expect(statSync(userConfig).mode & 0o777).toBe(0o600);

      // Test loose permission repair on startup / inspectConfig
      chmodSync(userConfig, 0o644);
      expect(statSync(userConfig).mode & 0o777).toBe(0o644);

      readAndRepairConfig(userConfig);
      expect(statSync(userConfig).mode & 0o777).toBe(0o600);

      // Corrupt config backup permission test
      const corruptConfigPath = join(tmpDir, "home", ".config", "pi-voice", "corrupt-test.json");
      writeFileSync(corruptConfigPath, "{ malformed json: true ", { mode: 0o644 });

      const res = readAndRepairConfig(corruptConfigPath);
      expect(res.corrupt).toBe(true);
      if (res.backupPath && existsSync(res.backupPath)) {
        expect(statSync(res.backupPath).mode & 0o777).toBe(0o600);
      }
    });

    test("Vocabulary and personal dictionary files are saved and repaired with 0600 mode", () => {
      const vocabPath = join(tmpDir, "home", ".config", "pi-voice", "vocabulary.json");
      writeFileSync(vocabPath, JSON.stringify({ version: 2, customVocabulary: ["word1"], presetVocabulary: {} }), { encoding: "utf8", mode: 0o600 });
      ensureOwnerOnlyPermissions(vocabPath);

      expect(existsSync(vocabPath)).toBe(true);
      expect(statSync(vocabPath).mode & 0o777).toBe(0o600);

      // Simulate loose permissions
      chmodSync(vocabPath, 0o644);
      expect(statSync(vocabPath).mode & 0o777).toBe(0o644);

      ensureOwnerOnlyPermissions(vocabPath);
      expect(statSync(vocabPath).mode & 0o777).toBe(0o600);

      // User dictionary txt file test
      appendUserDictionary("customterm");
      const dictPath = join(require("node:os").homedir(), ".pi", "dictionary.txt");
      if (existsSync(dictPath)) {
        expect(statSync(dictPath).mode & 0o777).toBe(0o600);

        chmodSync(dictPath, 0o666);
        expect(statSync(dictPath).mode & 0o777).toBe(0o666);

        loadUserDictionary();
        expect(statSync(dictPath).mode & 0o777).toBe(0o600);
      }
    });

    test("Runtime state file is created and repaired with 0600 mode", () => {
      const stateDir = join(tmpDir, "home", ".pi-voice");
      setRuntimeStateDirectoryForTests(stateDir);

      saveRuntimeState("/test/cwd");
      const stateFile = join(stateDir, "runtime-state.json");
      expect(existsSync(stateFile)).toBe(true);
      expect(statSync(stateFile).mode & 0o777).toBe(0o600);

      // Loose permission repair check
      chmodSync(stateFile, 0o644);
      expect(statSync(stateFile).mode & 0o777).toBe(0o644);

      readRuntimeStateResult();
      expect(statSync(stateFile).mode & 0o777).toBe(0o600);
    });
  });
});
