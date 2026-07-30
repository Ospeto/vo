import fs from "node:fs";
import { join } from "node:path";
import * as childProcess from "node:child_process";
import { mock } from "bun:test";

mock.module("../../services/logger.js", () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
mock.module("../../services/vocabulary-service.js", () => ({
  loadPersistedVocabulary: () => ({ customVocabulary: [], presetVocabulary: {}, entries: [] }),
  savePersistedVocabulary: () => {},
  migrateVocabulary: (_custom: string[], _preset: Record<string, string[]>, entries: unknown[] = []) => entries,
  backfillLegacyWhitespace: (entries: unknown[]) => entries,
}));

const [id, root] = process.argv.slice(2);
if (!id || !root) throw new Error("usage: config-recovery-worker <A|B|timeout> <root>");

if (id === "timeout") {
  const realSpawn = childProcess.spawn;
  let helper: childProcess.ChildProcess | undefined;
  let exited = false;
  let resolveExit: (() => void) | undefined;
  const helperExited = new Promise<void>((resolve) => { resolveExit = resolve; });

  mock.module("node:child_process", () => ({
    ...childProcess,
    spawn(command: string, args: string[], options: childProcess.SpawnOptions) {
      const testArgs = [...args];
      const commandIndex = testArgs.indexOf("-c");
      if (commandIndex !== -1) testArgs[commandIndex + 1] = "cat";
      helper = realSpawn(command, testArgs, options);
      helper.once("exit", () => {
        exited = true;
        resolveExit?.();
      });
      fs.writeFileSync(join(root, "helper-pid"), String(helper.pid));
      const confirmedPath = join(root, "cat-confirmed");
      for (let attempt = 0; attempt < 200 && !fs.existsSync(confirmedPath); attempt++) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      return helper;
    },
  }));

  const { loadConfig, ConfigError } = await import("../../services/config.js");
  let timedOut = false;
  try {
    loadConfig(join(root, "project"));
  } catch (error) {
    timedOut = error instanceof ConfigError && error.message.includes("Timed out");
  }

  if (!exited) await helperExited;
  const pid = helper?.pid;
  let groupGone = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (pid) process.kill(-pid, 0);
    } catch {
      groupGone = true;
      break;
    }
    await Bun.sleep(5);
  }
  console.log(JSON.stringify({
    timedOut,
    stdinDestroyed: helper?.stdin?.destroyed === true,
    reaped: exited && (helper?.exitCode ?? helper?.signalCode) !== null,
    groupGone,
  }));
  process.exit(0);
}

const markers = join(root, "markers");
fs.writeFileSync(join(markers, `ready-${id}`), "");
const other = join(markers, `ready-${id === "A" ? "B" : "A"}`);
while (!fs.existsSync(other)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);

const { updateConfig } = await import("../../services/config.js");
const result = updateConfig(
  join(root, "project"),
  id === "A" ? { inputGain: 1.1 } : { targetLanguage: "French" },
);
console.log(JSON.stringify({ id, inputGain: result.inputGain, targetLanguage: result.targetLanguage }));
