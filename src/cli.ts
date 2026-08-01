/**
 * Lightweight CLI for vo.
 * Runs without Electron – only `start` spawns the Electron daemon.
 * All other commands talk to the running daemon via Unix socket.
 */

import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import {
  readRuntimeState,
  removeRuntimeState,
} from "./services/runtime-state.js";
import { sendCommand } from "./services/daemon-ipc.js";
import { loadConfig, ConfigError } from "./services/config.js";
import { resolveModelPath } from "./services/whisper-model.js";

type Command = "start" | "status" | "stop" | "doctor" | "show" | "gui";

function usage(): never {
  console.log(`Usage: vo <command>

Commands:
  start   Start the vo daemon in the background (default)
  gui     Toggle the macOS Menu Bar GUI Popover window
  status  Show daemon status (state, PID, uptime)
  stop    Stop the running daemon
  doctor  Run system health & permission diagnostics`);
  process.exit(0);
}

function parseCommand(): Command {
  const arg = process.argv[2];
  if (!arg || arg === "start") return "start";
  if (arg === "gui" || arg === "show") return "show";
  if (arg === "status") return "status";
  if (arg === "stop") return "stop";
  if (arg === "doctor") return "doctor";
  if (arg === "--help" || arg === "-h") usage();
  console.error(`Unknown command: ${arg}`);
  usage();
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Walk up from `dir` to find the nearest directory containing package.json. */
function findPackageRoot(dir: string): string {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      console.error("Could not find package root (no package.json found).");
      process.exit(1);
    }
    current = parent;
  }
}

/** Check if the daemon appears to be running (PID file + process alive). */
function isDaemonRunning(): boolean {
  return readRuntimeState() !== null;
}

// ── doctor ──────────────────────────────────────────────────────────
async function cmdDoctor(): Promise<void> {
  console.log("🩺 Running vo System Health Diagnostics...\n");

  // 1. Check Gemini API Key
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    console.log("  [✓] GEMINI_API_KEY: Configured");
  } else {
    console.log("  [!] GEMINI_API_KEY: Missing in environment");
  }

  // 2. Check macOS System Events Permission via osascript
  try {
    execSync(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`, { timeout: 1000, stdio: "ignore" });
    console.log("  [✓] macOS System Events Accessibility: Granted");
  } catch {
    console.log("  [!] macOS System Events Accessibility: Needs Permission (System Settings -> Privacy & Security -> Accessibility)");
  }

  // 3. Check Personal Dictionary
  const dictFile = join(homedir(), ".pi", "dictionary.txt");
  if (existsSync(dictFile)) {
    try {
      const terms = readFileSync(dictFile, "utf-8").split("\n").filter(Boolean);
      console.log(`  [✓] Personal Dictionary: Active (${terms.length} vocabulary terms)`);
    } catch {
      console.log("  [✓] Personal Dictionary: Present");
    }
  } else {
    console.log("  [!] Personal Dictionary: Not initialized yet");
  }

  // 4. Check Daemon Status
  const state = readRuntimeState();
  if (state) {
    try {
      const res = await sendCommand("status");
      if (res.ok) {
        console.log(`  [✓] Daemon Status: Running (PID ${res.pid}, state: ${res.state})`);
      } else {
        console.log(`  [!] Daemon Status: Running but error returned (${res.error})`);
      }
    } catch {
      console.log("  [!] Daemon Status: Stale PID file found");
    }
  } else {
    console.log("  [!] Daemon Status: Stopped");
  }

  console.log("\nDiagnostics Complete.");
}

// ── status ──────────────────────────────────────────────────────────
async function cmdStatus(): Promise<void> {
  const state = readRuntimeState();
  if (!state) {
    console.log("not running");
    return;
  }

  try {
    const res = await sendCommand("status");
    if (res.ok) {
      const uptime = typeof res.uptime === "number" ? Math.floor(res.uptime as number) : "?";
      const nativePasteInfo = res.nativePaste && typeof res.nativePaste === "object"
        ? (res.nativePaste as { ready?: boolean; reason?: string }).ready
          ? "ready"
          : `unavailable (${(res.nativePaste as { reason?: string }).reason ?? "unknown"})`
        : "unknown";
      console.log(
        `running: ${res.cwd} (pid: ${res.pid}, state: ${res.state}, uptime: ${uptime}s, native paste: ${nativePasteInfo})`
      );
    } else {
      console.log(
        `running: ${state.cwd} (pid: ${state.pid}, since: ${state.startedAt})`
      );
      console.log(`  (daemon responded with error: ${res.error})`);
    }
  } catch {
    removeRuntimeState(state.pid);
    console.log("not running (stale state cleaned up)");
  }
}

// ── stop ────────────────────────────────────────────────────────────
async function cmdStop(): Promise<void> {
  if (!isDaemonRunning()) {
    console.log("vo daemon is not running.");
    process.exit(1);
  }

  try {
    const res = await sendCommand("stop");
    if (res.ok) {
      console.log("Stopping vo daemon...");
    } else {
      console.error(`Failed to stop daemon: ${res.error}`);
      process.exit(1);
    }
  } catch {
    const state = readRuntimeState();
    if (state) {
      try {
        process.kill(state.pid, "SIGTERM");
        console.log(`Stopping vo daemon (pid: ${state.pid})...`);
      } catch {
        removeRuntimeState(state.pid);
        console.log("vo daemon is not running (stale state cleaned up).");
        process.exit(1);
      }
    }
  }
}

// ── start ───────────────────────────────────────────────────────────
async function cmdStart(): Promise<void> {
  if (isDaemonRunning()) {
    const state = readRuntimeState()!;
    console.error(
      `vo daemon is already running in ${state.cwd} (pid: ${state.pid}).`
    );
    process.exit(1);
  }

  const cwd = process.cwd();

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
    } else {
      console.error(`Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }

  if (config.provider === "local") {
    try {
      await resolveModelPath();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to prepare Whisper model: ${msg}`);
      process.exit(1);
    }
  }

  const projectRoot = findPackageRoot(import.meta.dirname);
  let electronBin: string;
  try {
    const _require = createRequire(import.meta.url);
    electronBin = _require("electron") as unknown as string;
  } catch {
    console.error("Could not find electron binary. Is 'electron' installed?");
    process.exit(1);
  }

  const mainEntry = join(projectRoot, "out", "main", "index.js");
  if (!existsSync(mainEntry)) {
    console.error(
      "Electron main entry not found. Run 'bun run build' first."
    );
    process.exit(1);
  }

  const child = spawn(electronBin, [mainEntry], {
    cwd,
    env: {
      ...process.env,
      PI_VOICE_CWD: cwd,
    },
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  console.log(`vo daemon started (pid: ${child.pid}, cwd: ${cwd})`);
  console.log(`  key: ${config.keyDisplay}, provider: ${config.provider}`);
}

// ── show / gui ───────────────────────────────────────────────────────
async function cmdShow(): Promise<void> {
  if (!isDaemonRunning()) {
    console.log("vo daemon is not running. Starting daemon...");
    await cmdStart();
    return;
  }

  try {
    const res = await sendCommand("show");
    if (res.ok) {
      console.log("Toggled macOS Menu Bar GUI Popover window");
    } else {
      console.error(`Failed to show GUI: ${res.error}`);
    }
  } catch (err: any) {
    console.error(`Could not connect to daemon: ${err?.message || String(err)}`);
  }
}

// ── Exported Helpers for CLI Readiness & Lifecycle ──────────────────
export function daemonResponseMatchesState(expectedPid: number, response: any): boolean {
  return Boolean(response && response.ok === true && response.pid === expectedPid);
}

export async function waitForDaemonReady(
  child: any,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    request?: () => Promise<any>;
  }
): Promise<{ ok: boolean; error?: string }> {
  const timeoutMs = options?.timeoutMs ?? 2000;
  const intervalMs = options?.intervalMs ?? 50;
  const requestFn = options?.request ?? (() => sendCommand("status"));

  let exited = false;
  const onExit = () => { exited = true; };
  child.on?.("exit", onExit);
  child.on?.("error", onExit);

  const start = Date.now();

  try {
    while (Date.now() - start < timeoutMs) {
      if (exited) {
        return { ok: false, error: "daemon exited before readiness" };
      }
      try {
        const res = await requestFn();
        if (res && res.ok === true && typeof res.pid === "number" && res.pid > 0 && typeof res.state === "string" && typeof res.cwd === "string" && typeof res.uptime === "number" && res.uptime >= 0) {
          return { ok: true };
        } else {
          return { ok: false, error: "malformed response" };
        }
      } catch {
        // Retry until timeout
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { ok: false, error: "timeout waiting for daemon" };
  } finally {
    child.removeListener?.("exit", onExit);
    child.removeListener?.("error", onExit);
  }
}

export async function prepareSpawnedDaemon(
  child: any,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    request?: () => Promise<any>;
  }
): Promise<{ ok: boolean; error?: string }> {
  const result = await waitForDaemonReady(child, options);
  if (!result.ok) {
    try {
      child.kill?.();
    } catch {}
    try {
      child.unref?.();
    } catch {}
  }
  return result;
}

export async function runStatus(options: {
  readState: () => any;
  send: (cmd: string) => Promise<any>;
  log: (line: string) => void;
}): Promise<void> {
  const stateResult = options.readState();
  if (stateResult.kind === "absent") {
    options.log("not running");
    return;
  }

  try {
    const res = await options.send("status");
    if (res && res.ok === true && res.pid === stateResult.state.pid) {
      options.log(`running: ${res.cwd} (pid: ${res.pid}, state: ${res.state}, uptime: ${res.uptime}s)`);
    } else {
      options.log("unavailable (alive); state preserved");
    }
  } catch {
    options.log("unavailable (alive); state preserved");
  }
}

export async function runStop(options: {
  readState: () => any;
  send: (cmd: string) => Promise<any>;
  error: (line: string) => void;
}): Promise<number> {
  const stateResult = options.readState();
  if (stateResult.kind === "absent") {
    return 1;
  }

  try {
    const statusRes = await options.send("status");
    if (!statusRes || !statusRes.ok || statusRes.pid !== stateResult.state.pid) {
      options.error("state preserved and no signal was sent");
      return 1;
    }
    const shutdownRes = await options.send("shutdown");
    if (!shutdownRes || !shutdownRes.ok) {
      options.error(`state preserved and no signal was sent: ${shutdownRes?.error || "Unknown error"}`);
      return 1;
    }
    return 0;
  } catch (err: any) {
    options.error(`state preserved and no signal was sent: ${err?.message || String(err)}`);
    return 1;
  }
}

// ── main ────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("vo")) {
  const command = parseCommand();
  switch (command) {
    case "start":
      await cmdStart();
      break;
    case "show":
    case "gui":
      await cmdShow();
      break;
    case "status":
      await cmdStatus();
      break;
    case "stop":
      await cmdStop();
      break;
    case "doctor":
      await cmdDoctor();
      break;
  }
}
