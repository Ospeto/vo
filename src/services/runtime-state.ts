import { join } from "node:path";
import { homedir } from "node:os";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";

export interface RuntimeState {
  pid: number;
  cwd: string;
  startedAt: string; // ISO 8601
}

export type RuntimeStateReadResult =
  | { kind: "present"; revision: number; liveness: "alive" | "dead"; state: RuntimeState }
  | { kind: "missing" | "corrupt"; revision: number; liveness?: "none"; state: null };

let customStateDir: string | null = null;
let stateRevision = 0;

export function setRuntimeStateDirectoryForTests(dir: string | null): void {
  customStateDir = dir;
}

function getStateDir(): string {
  return customStateDir ?? join(homedir(), ".pi-voice");
}

function getStateFile(): string {
  return join(getStateDir(), "runtime-state.json");
}

function getSocketFile(): string {
  return join(getStateDir(), "daemon.sock");
}

/**
 * Return the path to the daemon Unix domain socket.
 */
export function getSocketPath(): string {
  ensureDir();
  return getSocketFile();
}

/**
 * Ensure the state directory exists.
 */
function ensureDir(): void {
  const dir = getStateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Check whether a given PID is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

/**
 * Save runtime state to disk (called on successful start).
 */
export function saveRuntimeState(cwd: string): { revision: number } {
  ensureDir();
  stateRevision++;
  const state: RuntimeState = {
    pid: process.pid,
    cwd,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(getStateFile(), JSON.stringify(state, null, 2));
  return { revision: stateRevision };
}

export function readRuntimeStateResult(): RuntimeStateReadResult {
  const file = getStateFile();
  if (!existsSync(file)) return { kind: "missing", revision: stateRevision, state: null };

  try {
    const raw = readFileSync(file, "utf-8");
    const state: RuntimeState = JSON.parse(raw);
    const alive = isProcessAlive(state.pid);
    return {
      kind: "present",
      revision: stateRevision,
      liveness: alive ? "alive" : "dead",
      state,
    };
  } catch {
    return { kind: "corrupt", revision: stateRevision, state: null };
  }
}

/**
 * Read runtime state from disk. Returns null if not running
 * (missing file, stale PID, etc.).
 */
export function readRuntimeState(): RuntimeState | null {
  const res = readRuntimeStateResult();
  if (res.kind === "present" && res.liveness === "alive") {
    return res.state;
  }
  if (res.kind === "present" && res.liveness === "dead") {
    removeRuntimeState();
    return null;
  }
  return null;
}

export function removeRuntimeStateIfRevision(revision?: number): { ok: boolean; removed: boolean } {
  if (revision !== undefined && revision !== stateRevision) {
    return { ok: true, removed: false };
  }
  removeRuntimeState();
  return { ok: true, removed: true };
}

/**
 * Remove runtime state file (called on graceful shutdown).
 */
export function removeRuntimeState(): void {
  try {
    const file = getStateFile();
    if (existsSync(file)) unlinkSync(file);
  } catch {
    // Ignore - best effort
  }
}
