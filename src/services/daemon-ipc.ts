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
import { existsSync, unlinkSync } from "node:fs";
import { getSocketPath } from "./runtime-state.js";
import logger from "./logger.js";

// ── Types ────────────────────────────────────────────────────────────

export type DaemonCommand = "status" | "stop" | "show" | "shutdown" | "cancel" | "interrupt";

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
export function startDaemonServer(handler: CommandHandler): string {
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

    conn.on("data", async (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const req: DaemonRequest = JSON.parse(line);
          const res = await handler(req.command);
          conn.write(JSON.stringify(res) + "\n");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          conn.write(JSON.stringify({ ok: false, error: msg }) + "\n");
        }
      }
    });

    conn.on("error", () => {
      // client disconnected – ignore
    });
  });

  server.listen(socketPath);
  logger.info({ socketPath }, "DaemonIPC listening");
  return socketPath;
}

/**
 * Stop the daemon IPC server and remove the socket file.
 */
export function stopDaemonServer(): void {
  if (server) {
    server.close();
    server = null;
  }
  const socketPath = getSocketPath();
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }
  logger.info("DaemonIPC server stopped");
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
