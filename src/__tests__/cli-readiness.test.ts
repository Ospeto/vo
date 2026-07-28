import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { daemonResponseMatchesState, prepareSpawnedDaemon, waitForDaemonReady, runStatus, runStop } from "../cli.js";
import type { RuntimeStateReadResult } from "../services/runtime-state.js";

class FakeChild extends EventEmitter {
  kills = 0;
  unrefs = 0;
  kill() { this.kills++; return true; }
  unref() { this.unrefs++; }
}

describe("CLI daemon readiness", () => {
  test("matches status only when the IPC PID matches state", () => {
    const response = { ok: true as const, state: "idle" as const, cwd: "/tmp", pid: 42, uptime: 1 };
    expect(daemonResponseMatchesState(42, response)).toBe(true);
    expect(daemonResponseMatchesState(43, response)).toBe(false);
    expect(daemonResponseMatchesState(42, { ok: false, error: "unavailable" })).toBe(false);
  });

  test("times out within the configured bound", async () => {
    const started = Date.now();
    const result = await waitForDaemonReady(new FakeChild(), {
      timeoutMs: 25, intervalMs: 5, request: async () => { throw Object.assign(new Error("not ready"), { code: "ECONNREFUSED" }); },
    });
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(250);
  });

  test("reports child exit and error before readiness", async () => {
    const child = new FakeChild();
    const pending = waitForDaemonReady(child, { timeoutMs: 500, intervalMs: 10, request: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } });
    child.emit("exit");
    expect(await pending).toEqual({ ok: false, error: "daemon exited before readiness" });

    const errored = new FakeChild();
    const errorPending = waitForDaemonReady(errored, { timeoutMs: 500, intervalMs: 10, request: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } });
    errored.emit("error");
    expect(await errorPending).toEqual({ ok: false, error: "daemon exited before readiness" });
  });

  test("fails immediately on malformed readiness response", async () => {
    for (const response of [
      { ok: true },
      { ok: true, state: "idle" },
      { ok: true, state: "idle", cwd: "/tmp", pid: "1", uptime: 0 },
      { ok: true, state: "idle", cwd: "/tmp", pid: 1, uptime: -1 },
    ]) {
      const result = await waitForDaemonReady(new FakeChild(), {
        timeoutMs: 500, intervalMs: 10,
        request: async () => response as never,
      });
      expect(result.ok).toBe(false);
    }
  });

  test("accepts a complete validated status response", async () => {
    const result = await waitForDaemonReady(new FakeChild(), {
      request: async () => ({ ok: true as const, state: "idle" as const, cwd: "/tmp", pid: 1, uptime: 0 }),
    });
    expect(result.ok).toBe(true);
  });

  test("cleans up the owned child and fails on timeout, exit, error, and malformed response", async () => {
    const cases = [
      async (child: FakeChild) => prepareSpawnedDaemon(child, { timeoutMs: 20, intervalMs: 5, request: async () => { throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); } }),
      async (child: FakeChild) => { const result = prepareSpawnedDaemon(child, { timeoutMs: 500, intervalMs: 5, request: async () => { throw Object.assign(new Error("offline"), { code: "ENOENT" }); } }); child.emit("exit"); return result; },
      async (child: FakeChild) => { const result = prepareSpawnedDaemon(child, { timeoutMs: 500, intervalMs: 5, request: async () => { throw Object.assign(new Error("offline"), { code: "ENOENT" }); } }); child.emit("error"); return result; },
      async (child: FakeChild) => prepareSpawnedDaemon(child, { request: async () => ({ ok: true } as never) }),
    ];
    for (const run of cases) {
      const child = new FakeChild();
      const result = await run(child);
      expect(result.ok).toBe(false);
      expect(child.kills).toBe(1);
      expect(child.unrefs).toBe(1);
    }
  });
});

describe("CLI status and stop ownership flows", () => {
  const state = { version: 1 as const, instanceId: "00000000-0000-4000-8000-000000000001", pid: 42, cwd: "/tmp/project", startedAt: new Date(0).toISOString() };
  const owned = (): RuntimeStateReadResult => ({ kind: "present", state, revision: 1, liveness: "alive" });

  test("status preserves state when IPC fails", async () => {
    const output: string[] = [];
    await runStatus({ readState: owned, send: async () => { throw new Error("socket unavailable"); }, log: (line) => output.push(line) });
    expect(output).toEqual(["unavailable (alive); state preserved"]);
  });

  test("stop does not shut down or signal on IPC failure", async () => {
    const commands: string[] = [];
    const errors: string[] = [];
    const result = await runStop({ readState: owned, send: async (command) => { commands.push(command); throw new Error("socket unavailable"); }, error: (line) => errors.push(line) });
    expect(result).toBe(1);
    expect(commands).toEqual(["status"]);
    expect(errors[0]).toContain("state preserved and no signal was sent");
  });

  test("stop does not shut down or signal when status PID mismatches", async () => {
    const commands: string[] = [];
    const result = await runStop({
      readState: owned,
      send: async (command) => { commands.push(command); return { ok: true as const, state: "idle" as const, cwd: "/tmp/other", pid: 43, uptime: 1 }; },
      error: () => {},
    });
    expect(result).toBe(1);
    expect(commands).toEqual(["status"]);
  });

  test("stop shuts down only after status PID matches state PID", async () => {
    const commands: string[] = [];
    const result = await runStop({
      readState: owned,
      send: async (command) => { commands.push(command); return command === "status" ? { ok: true as const, state: "idle" as const, cwd: state.cwd, pid: state.pid, uptime: 1 } : { ok: true as const } as never; },
      error: () => {},
    });
    expect(result).toBe(0);
    expect(commands).toEqual(["status", "shutdown"]);
  });

  test("CLI shutdown returns success when daemon protocol accepts shutdown command", async () => {
    const oldDaemonHandler = (command: string) => {
      if (command === "status") return { ok: true, state: "idle", cwd: state.cwd, pid: state.pid, uptime: 1 };
      if (command === "stop") return { ok: true };
      return { ok: false, error: `Unknown command: ${command}` };
    };

    const newDaemonHandler = (command: string) => {
      if (command === "status") return { ok: true, state: "idle", cwd: state.cwd, pid: state.pid, uptime: 1 };
      if (command === "stop" || command === "shutdown") return { ok: true };
      return { ok: false, error: `Unknown command: ${command}` };
    };

    // Demonstrates old daemon fails shutdown command
    const oldResult = await runStop({
      readState: owned,
      send: async (cmd) => oldDaemonHandler(cmd),
      error: () => {},
    });
    expect(oldResult).toBe(1);

    // Demonstrates new daemon handler succeeds on shutdown command
    const newResult = await runStop({
      readState: owned,
      send: async (cmd) => newDaemonHandler(cmd),
      error: () => {},
    });
    expect(newResult).toBe(0);
  });
});
