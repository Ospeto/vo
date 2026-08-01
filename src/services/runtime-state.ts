import { join } from "node:path";
import { homedir } from "node:os";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  linkSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { ensureOwnerOnlyPermissions } from "../shared/permission-utils.js";

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
 * Uses an atomic write-and-rename protocol so consumers/removers never observe
 * a partially-written or truncated state file.
 */
export function saveRuntimeState(cwd: string): { revision: number } {
  ensureDir();
  stateRevision++;
  const state: RuntimeState = {
    pid: process.pid,
    cwd,
    startedAt: new Date().toISOString(),
  };

  const targetFile = getStateFile();
  const tmpFile = `${targetFile}.tmp.write.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmpFile, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
    chmodSync(tmpFile, 0o600);
    renameSync(tmpFile, targetFile);
    ensureOwnerOnlyPermissions(targetFile);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {}
    throw err;
  }

  return { revision: stateRevision };
}

export function readRuntimeStateResult(): RuntimeStateReadResult {
  const file = getStateFile();
  if (!existsSync(file)) return { kind: "missing", revision: stateRevision, state: null };

  ensureOwnerOnlyPermissions(file);

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
    removeRuntimeState(res.state.pid);
    return null;
  }
  return null;
}

export function removeRuntimeStateIfRevision(revision?: number): { ok: boolean; removed: boolean } {
  if (revision !== undefined && revision !== stateRevision) {
    return { ok: true, removed: false };
  }
  const removed = removeRuntimeState();
  return { ok: true, removed };
}

/**
 * Remove runtime state file (called on graceful shutdown or stale cleanup).
 * Uses an atomic rename-and-verify protocol so a replacement process's state
 * file is never deleted even if written concurrently during removal.
 */
export function removeRuntimeState(expectedPid: number = process.pid): boolean {
  try {
    const file = getStateFile();
    if (!existsSync(file)) return false;

    // Atomic isolation via unique temp path
    const tmpPath = `${file}.tmp.del.${expectedPid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    try {
      renameSync(file, tmpPath);
    } catch {
      return false;
    }

    let shouldUnlink = false;
    try {
      const rawTmp = readFileSync(tmpPath, "utf-8");
      const tmpState: RuntimeState = JSON.parse(rawTmp);
      if (tmpState && typeof tmpState.pid === "number" && tmpState.pid === expectedPid) {
        shouldUnlink = true;
      }
    } catch {
      shouldUnlink = false;
    }

    if (shouldUnlink) {
      unlinkSync(tmpPath);
      return true;
    } else {
      // Atomic no-clobber restoration: linkSync fails atomically with EEXIST if replacement process already created target file
      try {
        linkSync(tmpPath, file);
      } catch {
        // EEXIST or failure: replacement process file is preserved
      }
      try {
        unlinkSync(tmpPath);
      } catch {}
      return false;
    }
  } catch {
    return false;
  }
}
