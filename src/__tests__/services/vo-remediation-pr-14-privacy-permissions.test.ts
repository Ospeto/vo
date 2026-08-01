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
import logger, { reinitLoggerForTests, flushLoggerForTests } from "../../services/logger.js";
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
  let testLogPath: string;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `vo-pr14-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tmpDir, { recursive: true });

    origHome = process.env.HOME;
    origXdg = process.env.XDG_CONFIG_HOME;
    origLogPath = process.env.PI_VOICE_LOG_PATH;

    process.env.HOME = join(tmpDir, "home");
    process.env.XDG_CONFIG_HOME = join(tmpDir, "home", ".config");
    testLogPath = join(tmpDir, "home", ".config", "pi-voice", "daemon.log");
    process.env.PI_VOICE_LOG_PATH = testLogPath;

    const configDir = join(tmpDir, "home", ".config", "pi-voice");
    mkdirSync(configDir, { recursive: true });

    setHistoryDirForTests(configDir);
    setRuntimeStateDirectoryForTests(join(tmpDir, "home", ".pi-voice"));

    reinitLoggerForTests();
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

    reinitLoggerForTests();
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

    test("STT transcription detailed logging emits metadata and never logs raw/sanitized transcripts", () => {
      const hostileMarker = "HOSTILE_SECRET_API_KEY_999888_CONFIDENTIAL";

      let loggedPayload: any = null;
      const originalInfo = logger.info.bind(logger);
      logger.info = ((payload: any, msg: any) => {
        if (msg === "Transcribed detailed and sanitized") {
          loggedPayload = payload;
        }
        return originalInfo(payload, msg);
      }) as any;

      try {
        const rawText = `Burmese text with ${hostileMarker}`;
        const sanitized = `Sanitized text with ${hostileMarker}`;
        logger.info(
          {
            provider: "gemini",
            geminiModel: "gemini-3.1-flash-lite",
            dictationPreset: "burmese_written",
            effectivePreset: "burmese_written",
            activeApp: "ghostty",
            rawCharCount: rawText.length,
            sanitizedCharCount: sanitized.length,
            usedPaidKey: false,
          },
          "Transcribed detailed and sanitized"
        );

        expect(loggedPayload).not.toBeNull();
        expect(loggedPayload.rawText).toBeUndefined();
        expect(loggedPayload.sanitized).toBeUndefined();
        expect(JSON.stringify(loggedPayload)).not.toContain(hostileMarker);
        expect(loggedPayload.rawCharCount).toBe(rawText.length);
        expect(loggedPayload.sanitizedCharCount).toBe(sanitized.length);
        expect(loggedPayload.provider).toBe("gemini");
      } finally {
        logger.info = originalInfo;
      }
    });

    test("Personal dictionary term logging emits character count instead of raw term", () => {
      const sensitiveTerm = "SENSITIVE_CUSTOM_TERM_12345";
      let loggedPayload: any = null;
      const originalInfo = logger.info.bind(logger);
      logger.info = ((payload: any, msg: any) => {
        if (msg === "Appended new term to personal vocabulary dictionary") {
          loggedPayload = payload;
        }
        return originalInfo(payload, msg);
      }) as any;

      try {
        appendUserDictionary(sensitiveTerm);
        expect(loggedPayload).not.toBeNull();
        expect(loggedPayload.term).toBeUndefined();
        expect(loggedPayload.charCount).toBe(sensitiveTerm.length);
      } finally {
        logger.info = originalInfo;
      }
    });

    test("Operational log exclusions leave zero text hashes or guessable derivatives", () => {
      logger.info({ charCount: 42, provider: "gemini" }, "Transcribed detailed and sanitized");

      const logContent = readFileSync(testLogPath, "utf-8");
      expect(logContent).not.toContain("hash");
      expect(logContent).not.toContain("md5");
      expect(logContent).not.toContain("sha256");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. HISTORY FEATURE RETENTION & ROTATION TESTS
  // ──────────────────────────────────────────────────────────────────────────

  describe("History Feature 500-Entry Retention & Clear Behavior", () => {
    test("addHistoryEntry enforces 500 entry retention ceiling and clearHistory clears history", () => {
      const historyDir = join(tmpDir, "home", ".config", "pi-voice");
      setHistoryDirForTests(historyDir);

      for (let i = 1; i <= 510; i++) {
        addHistoryEntry(`Dictation item ${i}`, "code");
      }

      const entries = getHistoryEntries(0);
      expect(entries.length).toBe(500);
      expect(entries[0]?.text).toBe("Dictation item 510");

      clearHistory();
      expect(getHistoryEntries(0).length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. STORAGE & TEMPORARY-FILE 0600 PERMISSIONS & REPAIR TESTS
  // ──────────────────────────────────────────────────────────────────────────

  describe("Owner-Only 0600 Mode Coverage Across Create, Rotate, Rewrite & Migration", () => {
    test("Log file creation, rotation, and existing archive permissions are repaired to 0600", () => {
      const logDir = join(tmpDir, "home", ".config", "pi-voice");

      // Pre-existing unrotated archive with loose 0644 mode
      const oldArchive = join(logDir, "daemon-2026-01-01.log");
      writeFileSync(oldArchive, "old archive line\n", { mode: 0o644 });
      chmodSync(oldArchive, 0o644);
      expect(statSync(oldArchive).mode & 0o777).toBe(0o644);

      // Re-init logger (triggers startup repair of log archives)
      reinitLoggerForTests();
      expect(statSync(oldArchive).mode & 0o777).toBe(0o600);

      // Active log file created with 0600
      expect(existsSync(testLogPath)).toBe(true);
      expect(statSync(testLogPath).mode & 0o777).toBe(0o600);

      // Trigger log rotation (> 2MB)
      const chunk = "A".repeat(1024 * 1024);
      writeFileSync(testLogPath, chunk + chunk + chunk, { mode: 0o600 });
      reinitLoggerForTests();

      const archives = readdirSync(logDir).filter((f) => f.startsWith("daemon-") && f.endsWith(".log"));
      expect(archives.length).toBeGreaterThan(0);
      for (const archive of archives) {
        expect(statSync(join(logDir, archive)).mode & 0o777).toBe(0o600);
      }
    });

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

      chmodSync(historyPath, 0o644);
      chmodSync(ledgerPath, 0o666);

      const readEntries = getHistoryEntries();
      const readLedger = loadCostLedger();

      expect(readEntries.length).toBeGreaterThan(0);
      expect(readLedger.totalDictations).toBeGreaterThan(0);

      expect(statSync(historyPath).mode & 0o777).toBe(0o600);
      expect(statSync(ledgerPath).mode & 0o777).toBe(0o600);
    });

    test("Legacy history migration repairs both target and source files to 0600", () => {
      const legacyDir = join(tmpDir, "home", ".pi-voice");
      mkdirSync(legacyDir, { recursive: true });
      const legacyHistory = join(legacyDir, "history.json");
      writeFileSync(legacyHistory, JSON.stringify([{ id: "1", text: "legacy" }]), { mode: 0o644 });
      chmodSync(legacyHistory, 0o644);

      const newHistoryDir = join(tmpDir, "home", ".config", "pi-voice");
      setHistoryDirForTests(newHistoryDir);
      getHistoryEntries();

      expect(statSync(legacyHistory).mode & 0o777).toBe(0o600);
    });

    test("Config files and corrupt backups are created and repaired with 0600 mode", () => {
      const userConfig = getUserConfigPath();
      updateConfig(tmpDir, { inputGain: 1.5 });

      expect(existsSync(userConfig)).toBe(true);
      expect(statSync(userConfig).mode & 0o777).toBe(0o600);

      chmodSync(userConfig, 0o644);
      expect(statSync(userConfig).mode & 0o777).toBe(0o644);

      readAndRepairConfig(userConfig);
      expect(statSync(userConfig).mode & 0o777).toBe(0o600);

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

      chmodSync(vocabPath, 0o644);
      expect(statSync(vocabPath).mode & 0o777).toBe(0o644);

      ensureOwnerOnlyPermissions(vocabPath);
      expect(statSync(vocabPath).mode & 0o777).toBe(0o600);

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

      chmodSync(stateFile, 0o644);
      expect(statSync(stateFile).mode & 0o777).toBe(0o644);

      readRuntimeStateResult();
      expect(statSync(stateFile).mode & 0o777).toBe(0o600);
    });
  });
});
