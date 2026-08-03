/**
 * Unix socket–based IPC for daemon control.
 *
 * The daemon (Electron main process) runs a server on a Unix domain socket.
 * The CLI connects as a client, sends a JSON command, and receives a JSON response.
 *
 * Protocol (newline-delimited JSON):
 *   → { "command": "status" | "stop" | "show" | "shutdown" | "cancel" | "interrupt" }
 *   ← { "ok": true, ...payload } | { "ok": false, "error": "..." }
 */

import { createServer, createConnection, type Server } from "node:net";
import { existsSync, unlinkSync, chmodSync } from "node:fs";
import { getSocketPath } from "./runtime-state.js";
import logger from "./logger.js";

// ── Types ────────────────────────────────────────────────────────────

export type DaemonCommand = "status" | "stop" | "show" | "shutdown" | "cancel" | "interrupt";

const DAEMON_COMMANDS: ReadonlySet<string> = new Set([
  "status",
  "stop",
  "show",
  "shutdown",
  "cancel",
  "interrupt",
]);
const MAX_QUEUED_DAEMON_REQUESTS = 100;

function isDaemonCommand(value: unknown): value is DaemonCommand {
  return typeof value === "string" && DAEMON_COMMANDS.has(value);
}

export interface DaemonRequest {
  command: DaemonCommand;
  expectedPid?: number;
}

export interface DaemonResponse {
  ok: boolean;
  [key: string]: unknown;
}

export type CommandHandler = (
  command: DaemonCommand
) => DaemonResponse | Promise<DaemonResponse>;

// ── Server (daemon side) ─────────────────────────────────────────────

let server: Server | null = null;

/**
 * Start the daemon IPC server on a Unix domain socket.
 * Returns the socket path being listened on.
 */
export function startDaemonServer(handler: CommandHandler): Promise<string> {
  const socketPath = getSocketPath();

  // Clean up stale socket file
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }

  server = createServer((conn) => {
    let buffer = "";
    let queuedRequestCount = 0;
    let pending = Promise.resolve();
    const writeResponse = (response: DaemonResponse) => {
      if (conn.destroyed) return;
      try {
        conn.write(JSON.stringify(response) + "\n");
      } catch (err) {
        logger.debug({ err: String(err) }, "Failed to write daemon response");
      }
    };

    conn.on("data", (data) => {
      buffer += data.toString();
      if (Buffer.byteLength(buffer, "utf8") > 1024 * 1024) {
        logger.warn("DaemonIPC connection buffer exceeded 1MB limit; destroying connection");
        writeResponse({ ok: false, error: "Payload exceeds 1MB limit" });
        conn.destroy();
        return;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete line
      const requestLines = lines.filter((line) => line.trim());
      if (queuedRequestCount + requestLines.length > MAX_QUEUED_DAEMON_REQUESTS) {
        logger.warn("DaemonIPC request queue exceeded limit; destroying connection");
        writeResponse({ ok: false, error: "Too many queued requests" });
        conn.destroy();
        return;
      }
      queuedRequestCount += requestLines.length;

      // Preserve command order when multiple requests arrive while a handler awaits.
      pending = pending.then(async () => {
        try {
          for (const line of requestLines) {
            try {
              const parsed: unknown = JSON.parse(line);
              if (
                typeof parsed !== "object" ||
                parsed === null ||
                !isDaemonCommand((parsed as { command?: unknown }).command)
              ) {
                throw new Error("Invalid daemon command");
              }
              const res = await handler((parsed as DaemonRequest).command);
              writeResponse(res);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              writeResponse({ ok: false, error: msg });
            }
          }
        } finally {
          queuedRequestCount -= requestLines.length;
        }
      }).catch((err) => {
        logger.warn({ err: String(err) }, "DaemonIPC request queue failed");
      });
    });

    conn.on("error", () => {
      // client disconnected – ignore
    });
  });

  return new Promise<string>((resolve, reject) => {
    server!.once("listening", () => {
      try {
        chmodSync(socketPath, 0o600);
      } catch (err) {
        logger.warn({ socketPath, err: String(err) }, "Failed to secure daemon socket permissions");
      }
      logger.info({ socketPath }, "DaemonIPC listening");
      resolve(socketPath);
    });
    server!.once("error", (err) => {
      reject(err);
    });
    server!.listen(socketPath);
  });
}

/**
 * Stop the daemon IPC server and remove the socket file.
 * Unlinks the socket file immediately and returns a bounded promise for server close.
 */
export function stopDaemonServer(timeoutMs: number = 1000): Promise<void> {
  const activeServer = server;
  server = null;

  const socketPath = getSocketPath();
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }

  if (!activeServer) {
    logger.info("DaemonIPC server stopped");
    return Promise.resolve();
  }

  const closePromise = new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      resolve();
    };

    timer = setTimeout(done, timeoutMs);
    try {
      activeServer.close(() => done());
    } catch {
      done();
    }
  });

  logger.info("DaemonIPC server stopped");
  return closePromise;
}

// ── Client (CLI side) ────────────────────────────────────────────────

export function validateDaemonResponse(input: unknown, command: DaemonCommand = "status"): DaemonResponse {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error(`Invalid daemon ${command} response: bad json`);
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid daemon ${command} response: expected object`);
  }
  const res = parsed as DaemonResponse;
  if (typeof res.ok !== "boolean") {
    throw new Error(`Invalid daemon ${command} response: missing ok field`);
  }
  if (command === "status" && res.ok) {
    if (Object.keys(res).length === 1 || (typeof res.uptime === "number" && res.uptime < 0)) {
      throw new Error("Invalid daemon status response");
    }
  }
  return res;
}

/**
 * Send a command to the running daemon and return the response.
 * Throws if the daemon is not reachable.
 */
export function sendCommand(
  command: DaemonCommand,
  expectedPidOrSocketPath?: number | string,
  socketPathOrTimeout?: string | number,
  timeoutMs: number = 5000
): Promise<DaemonResponse> {
  let target = getSocketPath();
  let expectedPid: number | undefined;
  let timeoutLimit = timeoutMs;

  if (typeof expectedPidOrSocketPath === "string") {
    target = expectedPidOrSocketPath;
  } else if (typeof expectedPidOrSocketPath === "number") {
    expectedPid = expectedPidOrSocketPath;
  }

  if (typeof socketPathOrTimeout === "string") {
    target = socketPathOrTimeout;
  } else if (typeof socketPathOrTimeout === "number") {
    timeoutLimit = socketPathOrTimeout;
  }

  return new Promise((resolve, reject) => {
    const conn = createConnection(target);
    let buffer = "";
    const timeout = setTimeout(() => {
      conn.destroy();
      reject(new Error("Daemon did not respond within timeout"));
    }, timeoutLimit);

    conn.on("connect", () => {
      const payload: DaemonRequest = { command };
      if (expectedPid !== undefined) payload.expectedPid = expectedPid;
      conn.write(JSON.stringify(payload) + "\n");
    });

    conn.on("data", (data) => {
      buffer += data.toString();
      const idx = buffer.indexOf("\n");
      if (idx !== -1) {
        clearTimeout(timeout);
        const line = buffer.slice(0, idx);
        conn.end();
        try {
          resolve(validateDaemonResponse(line, command));
        } catch (err: any) {
          reject(new Error(`Invalid response from daemon: ${line}`));
        }
      }
    });

    conn.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
