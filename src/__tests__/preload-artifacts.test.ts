import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import vm from "vm";

describe("Packaged Preload Artifact Integrity & Sandboxed Self-Containment", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const preloadDir = path.join(repoRoot, "out/preload");

  beforeAll(() => {
    fs.rmSync(preloadDir, { recursive: true, force: true });

    // Seed an old chunk so this test proves the current checkout rebuilds cleanly.
    const staleChunk = path.join(preloadDir, "chunks/stale.cjs");
    fs.mkdirSync(path.dirname(staleChunk), { recursive: true });
    fs.writeFileSync(staleChunk, "// stale artifact");

    const result = spawnSync("bun", ["run", "build:electron"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`Electron preload build failed:\n${result.stdout}\n${result.stderr}`);
    }
  });

  test("all required preload entrypoints exist and no generated shared chunk files exist", () => {
    const requiredFiles = ["settings.cjs", "capture.cjs", "hud.cjs", "index.cjs"];
    for (const file of requiredFiles) {
      const filePath = path.join(preloadDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    }

    const chunksDir = path.join(preloadDir, "chunks");
    expect(fs.existsSync(chunksDir)).toBe(false);
  });

  test("no entrypoint contains runtime relative require of generated chunks", () => {
    const files = fs.readdirSync(preloadDir).filter((f) => f.endsWith(".cjs"));
    expect(files.length).toBeGreaterThanOrEqual(4);

    for (const file of files) {
      const content = fs.readFileSync(path.join(preloadDir, file), "utf8");
      expect(content).not.toMatch(/require\(["']\.\/chunks\//);
      expect(content).not.toMatch(/require\(["']\.\.\/chunks\//);
      expect(content).not.toMatch(/require\(["'][^"']*chunks\/shared/);
    }
  });

  test("each preload entrypoint exposes its role-scoped bridge without module loading errors", () => {
    const entrypointExpectations: Record<string, string[]> = {
      "settings.cjs": [
        "getConfig",
        "saveConfig",
        "registerHotkey",
        "registerEditHotkey",
        "getHistory",
        "clearHistory",
        "toggleDictation",
        "testApiKey",
        "previewChime",
        "cancelDictation",
        "onStateChanged",
        "onAudioLevelUpdate",
      ],
      "capture.cjs": [
        "getConfig",
        "sendRecordingData",
        "sendRecordingError",
        "sendAudioLevelUpdate",
        "onStartRecording",
        "onStopRecording",
        "onCancelRecording",
        "onGainUpdate",
      ],
      "hud.cjs": ["cancelDictation", "onStateChanged", "onAudioLevelUpdate"],
      "index.cjs": [
        "getConfig",
        "saveConfig",
        "registerHotkey",
        "registerEditHotkey",
        "getHistory",
        "clearHistory",
        "toggleDictation",
        "testApiKey",
        "previewChime",
        "cancelDictation",
        "onStateChanged",
        "onAudioLevelUpdate",
      ],
    };

    for (const [filename, expectedMethods] of Object.entries(entrypointExpectations)) {
      const code = fs.readFileSync(path.join(preloadDir, filename), "utf8");

      let exposedApiKey: string | null = null;
      let exposedApi: Record<string, any> | null = null;

      const mockIpcRenderer = {
        invoke: () => Promise.resolve(),
        send: () => {},
        on: () => {},
        removeListener: () => {},
      };

      const mockContextBridge = {
        exposeInMainWorld: (key: string, api: any) => {
          exposedApiKey = key;
          exposedApi = api;
        },
      };

      const mockRequire = (modName: string) => {
        if (modName === "electron") {
          return {
            ipcRenderer: mockIpcRenderer,
            contextBridge: mockContextBridge,
          };
        }
        throw new Error(`Sandboxed preload loader rejected unexpected require: ${modName}`);
      };

      const sandboxContext = vm.createContext({
        require: mockRequire,
        exports: {},
        module: { exports: {} },
        console,
      });

      expect(() => {
        vm.runInContext(code, sandboxContext);
      }).not.toThrow();

      expect(exposedApiKey as string | null).toBe("piVoice");
      expect(exposedApi).not.toBeNull();

      for (const method of expectedMethods) {
        expect(typeof exposedApi![method]).toBe("function");
      }
    }
  });
});
