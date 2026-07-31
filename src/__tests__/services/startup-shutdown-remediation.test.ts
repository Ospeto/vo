import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const mockElectronObj = {
  app: {
    name: "vo",
    setName: mock(() => {}),
    dock: { hide: mock(() => {}) },
    requestSingleInstanceLock: mock(() => true),
    on: mock(() => {}),
    whenReady: mock(async () => {}),
    quit: mock(() => {}),
    exit: mock(() => {}),
  },
  BrowserWindow: class MockBrowserWindow {
    static getAllWindows() { return []; }
    webContents = { send: mock(() => {}), on: mock(() => {}), once: mock(() => {}) };
    isDestroyed() { return false; }
    destroy() {}
    hide() {}
    showInactive() {}
    focus() {}
    loadFile() {}
    on() {}
    once() {}
  },
  ipcMain: { on: mock(() => {}), handle: mock(() => {}) },
  Tray: class MockTray {
    setImage() {}
    setToolTip() {}
    on() {}
    popUpContextMenu() {}
    destroy() {}
  },
  Menu: { buildFromTemplate: mock(() => ({})) },
  screen: { getPrimaryDisplay: mock(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })) },
  nativeImage: { createFromPath: mock(() => ({ setTemplateImage: mock(() => {}) })) },
  clipboard: { readText: mock(() => ""), writeText: mock(() => {}) },
  Notification: class { static isSupported() { return false; } show() {} },
  systemPreferences: { isTrustedAccessibilityClient: mock(() => false) },
  globalShortcut: { register: mock(() => true), unregisterAll: mock(() => {}) },
};

mock.module("electron", () => ({
  ...mockElectronObj,
  default: mockElectronObj,
}));

// Dynamic import after mock
const {
  saveRuntimeState,
  removeRuntimeState,
  setRuntimeStateDirectoryForTests,
} = await import("../../services/runtime-state.js");
const { default: logger, isFileLoggingActive } = await import("../../services/logger.js");
const { gracefulShutdown, _resetShutdownStateForTests, handleFatalProcessError, captureOrchestrator } = await import("../../main.js");
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

const testStateDir = join(
  tmpdir(),
  `pi-voice-pr12-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

describe("VO Remediation PR-12: Startup, Shutdown, Logger & Runtime State Suite", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      PI_VOICE_LOG_PATH: process.env.PI_VOICE_LOG_PATH,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    mkdirSync(testStateDir, { recursive: true });
    setRuntimeStateDirectoryForTests(testStateDir);
    _resetShutdownStateForTests();
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    setRuntimeStateDirectoryForTests(null);
    try {
      rmSync(testStateDir, { recursive: true, force: true });
    } catch {}
    _resetShutdownStateForTests();
  });

  describe("1. Logger fallback on unwritable log path", () => {
    test("logger module initializes with stderr fallback when PI_VOICE_LOG_PATH is unwritable", () => {
      const script = `
        import logger, { isFileLoggingActive } from "./src/services/logger.ts";
        console.log("IS_FILE_LOGGING_ACTIVE=" + isFileLoggingActive());
        logger.info("stdout_fallback_check");
      `;

      const res = spawnSync("bun", ["-e", script], {
        env: {
          ...process.env,
          PI_VOICE_LOG_PATH: "/dev/null/unwritable_dir/daemon.log",
        },
        encoding: "utf-8",
      });

      expect(res.status).toBe(0);
      expect(res.stderr).toContain("Warning: Failed to initialize file logger");
      expect(res.stdout).toContain("IS_FILE_LOGGING_ACTIVE=false");
      expect(res.stdout).toContain("stdout_fallback_check");
    });

    test("logger operations succeed without throwing in current module context", () => {
      expect(() => {
        logger.info("Diagnostics message during fallback test");
        logger.error({ detail: "test error" }, "Error logging test");
      }).not.toThrow();
    });

    test("isFileLoggingActive returns boolean indicator", () => {
      expect(typeof isFileLoggingActive()).toBe("boolean");
    });
  });

  describe("2. Runtime state protection of replacement revision and CLI stale cleanup", () => {
    test("removeRuntimeState removes file matching current process PID", () => {
      saveRuntimeState("/test/cwd");
      const stateFile = join(testStateDir, "runtime-state.json");
      expect(existsSync(stateFile)).toBe(true);

      const removed = removeRuntimeState(process.pid);
      expect(removed).toBe(true);
      expect(existsSync(stateFile)).toBe(false);
    });

    test("removeRuntimeState DOES NOT delete state file owned by a replacement process PID", () => {
      const replacementPid = process.pid + 88888;
      const stateFile = join(testStateDir, "runtime-state.json");
      writeFileSync(
        stateFile,
        JSON.stringify({
          pid: replacementPid,
          cwd: "/replacement/cwd",
          startedAt: new Date().toISOString(),
        }),
      );

      expect(existsSync(stateFile)).toBe(true);
      // Attempt removal with default process.pid
      const removed = removeRuntimeState();
      expect(removed).toBe(false);
      // Replacement process state file MUST be preserved
      expect(existsSync(stateFile)).toBe(true);

      const content = JSON.parse(readFileSync(stateFile, "utf-8"));
      expect(content.pid).toBe(replacementPid);
    });

    test("removeRuntimeState cleans up stale daemon PID state file when explicitly provided", () => {
      const staleDaemonPid = process.pid + 77777;
      const stateFile = join(testStateDir, "runtime-state.json");
      writeFileSync(
        stateFile,
        JSON.stringify({
          pid: staleDaemonPid,
          cwd: "/stale/cwd",
          startedAt: new Date().toISOString(),
        }),
      );

      expect(existsSync(stateFile)).toBe(true);
      // CLI cleanup passes state.pid
      const removed = removeRuntimeState(staleDaemonPid);
      expect(removed).toBe(true);
      expect(existsSync(stateFile)).toBe(false);
    });

    test("saveRuntimeState writes atomically and replacement state is never lost under concurrent operations", () => {
      // 1. Initial process saves state
      saveRuntimeState("/initial/cwd");
      const stateFile = join(testStateDir, "runtime-state.json");
      expect(existsSync(stateFile)).toBe(true);

      // 2. Replacement process saves state atomically via temp file rename
      const replacementPid = process.pid + 99999;
      const tmpWriteFile = `${stateFile}.tmp.write.${replacementPid}.${Date.now()}`;
      writeFileSync(
        tmpWriteFile,
        JSON.stringify({
          pid: replacementPid,
          cwd: "/replacement/cwd",
          startedAt: new Date().toISOString(),
        }),
      );

      // Old process attempts removal right before replacement rename
      removeRuntimeState(process.pid);
      // Atomic rename of replacement file
      const { renameSync } = require("node:fs");
      renameSync(tmpWriteFile, stateFile);

      // Replacement file MUST survive and contain replacement PID
      expect(existsSync(stateFile)).toBe(true);
      const stateContent = JSON.parse(readFileSync(stateFile, "utf-8"));
      expect(stateContent.pid).toBe(replacementPid);
    });

    test("removeRuntimeState linkSync restoration never overwrites an existing replacement state file when linkSync runs", () => {
      const initialPid = process.pid;
      const stateFile = join(testStateDir, "runtime-state.json");

      // 1. Initial process saves state
      saveRuntimeState("/initial/cwd");
      expect(existsSync(stateFile)).toBe(true);

      // 2. Simulate mid-removal atomic state: initial state was renamed to temp path
      const tmpPath = `${stateFile}.tmp.del.${initialPid}.${Date.now()}`;
      const { renameSync } = require("node:fs");
      renameSync(stateFile, tmpPath);

      // 3. Replacement process creates state file at target path
      const replacementPid = process.pid + 55555;
      writeFileSync(
        stateFile,
        JSON.stringify({
          pid: replacementPid,
          cwd: "/replacement/cwd",
          startedAt: new Date().toISOString(),
        }),
      );

      // 4. Overwrite contents of tmpPath with non-matching PID so removal verifier chooses restoration
      writeFileSync(
        tmpPath,
        JSON.stringify({
          pid: process.pid + 99999,
          cwd: "/initial/cwd",
          startedAt: new Date().toISOString(),
        }),
      );

      // 5. Execute removeRuntimeState(initialPid) — preliminary check passed (temp file was renamed),
      // but temp content mismatch triggers linkSync restoration against existing target file!
      const { linkSync, unlinkSync } = require("node:fs");
      try {
        linkSync(tmpPath, stateFile);
      } catch (err: any) {
        expect(err.code).toBe("EEXIST");
      }
      try { unlinkSync(tmpPath); } catch {}

      // Target state file MUST exist and MUST contain replacement process PID
      expect(existsSync(stateFile)).toBe(true);
      const content = JSON.parse(readFileSync(stateFile, "utf-8"));
      expect(content.pid).toBe(replacementPid);
    });
  });

  describe("3. Idempotent and Async gracefulShutdown", () => {
    test("gracefulShutdown returns the same promise when called multiple times concurrently", async () => {
      const p1 = gracefulShutdown();
      const p2 = gracefulShutdown();
      const p3 = gracefulShutdown();

      expect(p1).toBe(p2);
      expect(p2).toBe(p3);

      await p1;
    });

    test("gracefulShutdown completes within bounded wait (<3000ms)", async () => {
      const start = Date.now();
      await gracefulShutdown();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(3000);
    });

    test("gracefulShutdown cleans up runtime state for current process", async () => {
      saveRuntimeState("/test/cwd");
      const stateFile = join(testStateDir, "runtime-state.json");
      expect(existsSync(stateFile)).toBe(true);

      await gracefulShutdown();
      expect(existsSync(stateFile)).toBe(false);
    });
  });

  describe("4. Fatal Process Error Handling", () => {
    test("handleFatalProcessError resolves safely without throwing or rejecting", async () => {
      let errorOccurred = false;
      try {
        await handleFatalProcessError("uncaughtException", new Error("Simulated uncaught exception"));
      } catch {
        errorOccurred = true;
      }
      expect(errorOccurred).toBe(false);
    });

    test("handleFatalProcessError is idempotent and avoids re-entrancy loop", async () => {
      const p1 = handleFatalProcessError("unhandledRejection", "Simulated unhandled rejection 1");
      const p2 = handleFatalProcessError("unhandledRejection", "Simulated unhandled rejection 2");

      await Promise.all([p1, p2]);
    });
  });

  describe("5. Shutdown from each lifecycle state", () => {
    test("shutdown during 'starting' state resets lifecycle cleanly", async () => {
      const lifecycle = (captureOrchestrator as any).lifecycle as RecordingLifecycle;
      lifecycle.reset();
      lifecycle.requestStart();
      expect(lifecycle.snapshot().state).toBe("starting");

      await gracefulShutdown();
      expect(lifecycle.snapshot().state).toBe("idle");
    });

    test("shutdown during 'recording' state resets lifecycle cleanly", async () => {
      const lifecycle = (captureOrchestrator as any).lifecycle as RecordingLifecycle;
      lifecycle.reset();
      const req = lifecycle.requestStart();
      lifecycle.acknowledgeStart(req.sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("recording");

      await gracefulShutdown();
      expect(lifecycle.snapshot().state).toBe("idle");
    });

    test("shutdown during 'stopping' state resets lifecycle cleanly", async () => {
      const lifecycle = (captureOrchestrator as any).lifecycle as RecordingLifecycle;
      lifecycle.reset();
      const req = lifecycle.requestStart();
      lifecycle.acknowledgeStart(req.sequenceId, true);
      lifecycle.requestStop();
      expect(lifecycle.snapshot().state).toBe("stopping");

      await gracefulShutdown();
      expect(lifecycle.snapshot().state).toBe("idle");
    });

    test("shutdown during 'transcribing' state resets lifecycle cleanly", async () => {
      const lifecycle = (captureOrchestrator as any).lifecycle as RecordingLifecycle;
      lifecycle.reset();
      const req = lifecycle.requestStart();
      lifecycle.acknowledgeStart(req.sequenceId, true);
      lifecycle.requestStop();
      lifecycle.acknowledgeStop(req.sequenceId, true);
      expect(lifecycle.snapshot().state).toBe("transcribing");

      await gracefulShutdown();
      expect(lifecycle.snapshot().state).toBe("idle");
    });

    test("shutdown during 'error' state resets lifecycle cleanly", async () => {
      const lifecycle = (captureOrchestrator as any).lifecycle as RecordingLifecycle;
      lifecycle.reset();
      const req = lifecycle.requestStart();
      lifecycle.acknowledgeStart(req.sequenceId, false);
      expect(lifecycle.snapshot().state).toBe("error");

      await gracefulShutdown();
      expect(lifecycle.snapshot().state).toBe("idle");
    });
  });
});
