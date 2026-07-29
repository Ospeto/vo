import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Mock logger to prevent file I/O during tests
mock.module("../../services/logger.js", () => ({
  default: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

import {
  parseKeyBinding,
  formatKeyDisplay,
  loadConfig,
  updateConfig,
  getUserConfigPath,
  getProjConfigPath,
  resolveConfigPath,
  ConfigError,
} from "../../services/config.js";

describe("parseKeyBinding", () => {
  test("parses simple key", () => {
    const result = parseKeyBinding("t");
    expect(result.keycode).toBeGreaterThan(0);
    expect(result.ctrl).toBe(false);
    expect(result.shift).toBe(false);
    expect(result.alt).toBe(false);
    expect(result.meta).toBe(false);
  });

  test("parses ctrl+t", () => {
    const result = parseKeyBinding("ctrl+t");
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(false);
    expect(result.alt).toBe(false);
    expect(result.meta).toBe(false);
  });

  test("parses meta+shift+i (default binding)", () => {
    const result = parseKeyBinding("meta+shift+i");
    expect(result.meta).toBe(true);
    expect(result.shift).toBe(true);
    expect(result.ctrl).toBe(false);
    expect(result.alt).toBe(false);
  });

  test("parses cmd as meta alias", () => {
    const result = parseKeyBinding("cmd+t");
    expect(result.meta).toBe(true);
  });

  test("parses command as meta alias", () => {
    const result = parseKeyBinding("command+t");
    expect(result.meta).toBe(true);
  });

  test("parses control as ctrl alias", () => {
    const result = parseKeyBinding("control+a");
    expect(result.ctrl).toBe(true);
  });

  test("parses opt/option as alt aliases", () => {
    expect(parseKeyBinding("opt+a").alt).toBe(true);
    expect(parseKeyBinding("option+a").alt).toBe(true);
  });

  test("parses function keys", () => {
    const f1 = parseKeyBinding("f1");
    expect(f1.keycode).toBeGreaterThan(0);
    const f12 = parseKeyBinding("f12");
    expect(f12.keycode).toBeGreaterThan(0);
    expect(f1.keycode).not.toBe(f12.keycode);
  });

  test("parses number keys", () => {
    const result = parseKeyBinding("ctrl+1");
    expect(result.ctrl).toBe(true);
    expect(result.keycode).toBeGreaterThan(0);
  });

  test("parses special keys", () => {
    expect(parseKeyBinding("space").keycode).toBeGreaterThan(0);
    expect(parseKeyBinding("enter").keycode).toBeGreaterThan(0);
    expect(parseKeyBinding("escape").keycode).toBeGreaterThan(0);
    expect(parseKeyBinding("tab").keycode).toBeGreaterThan(0);
  });

  test("parses arrow keys", () => {
    expect(parseKeyBinding("up").keycode).toBeGreaterThan(0);
    expect(parseKeyBinding("arrowup").keycode).toBeGreaterThan(0);
    // arrowup and up should map to same keycode
    expect(parseKeyBinding("up").keycode).toBe(parseKeyBinding("arrowup").keycode);
  });

  test("is case insensitive", () => {
    const lower = parseKeyBinding("ctrl+t");
    const upper = parseKeyBinding("Ctrl+T");
    expect(lower.keycode).toBe(upper.keycode);
    expect(lower.ctrl).toBe(upper.ctrl);
  });

  test("trims whitespace in parts", () => {
    const result = parseKeyBinding(" ctrl + t ");
    expect(result.ctrl).toBe(true);
  });

  test("throws on empty string", () => {
    expect(() => parseKeyBinding("")).toThrow("Invalid key binding");
  });

  test("throws on modifier-only binding", () => {
    expect(() => parseKeyBinding("ctrl")).toThrow("No non-modifier key specified");
  });

  test("throws on multiple main keys", () => {
    expect(() => parseKeyBinding("a+b")).toThrow("Multiple non-modifier keys");
  });

  test("throws on unknown key", () => {
    expect(() => parseKeyBinding("ctrl+unknownkey")).toThrow('Unknown key "unknownkey"');
  });

  test("throws on empty parts (double plus)", () => {
    expect(() => parseKeyBinding("ctrl++t")).toThrow("Invalid key binding");
  });

  test("all modifier combos at once", () => {
    const result = parseKeyBinding("ctrl+shift+alt+meta+t");
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(true);
    expect(result.alt).toBe(true);
    expect(result.meta).toBe(true);
  });
});

describe("formatKeyDisplay", () => {
  test("formats simple key on macOS", () => {
    const binding = parseKeyBinding("t");
    const display = formatKeyDisplay(binding);
    expect(display).toContain("T");
  });

  test("formats meta+shift+i binding", () => {
    const binding = parseKeyBinding("meta+shift+i");
    const display = formatKeyDisplay(binding);
    // On macOS it uses unicode symbols; on other platforms text labels
    expect(display.length).toBeGreaterThan(0);
    expect(display).toContain("I");
  });

  test("includes all modifiers in output", () => {
    const binding = parseKeyBinding("ctrl+shift+alt+meta+a");
    const display = formatKeyDisplay(binding);
    expect(display).toContain("A");
    // Should have at least 4 modifiers + key
    expect(display.length).toBeGreaterThan(4);
  });
});

describe("loadConfig", () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pi-voice-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = join(tmpDir, "home");
  });

  afterEach(() => {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns defaults when no config file exists", () => {
    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("gemini");
    expect(config.keyDisplay.length).toBeGreaterThan(0);
  });

  test("loads valid config file", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, "pi-voice.json"),
      JSON.stringify({ key: "ctrl+t", provider: "gemini" }),
    );

    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("gemini");
    expect(config.key.ctrl).toBe(true);
  });

  test("uses defaults for missing fields", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "pi-voice.json"), JSON.stringify({}));

    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("gemini");
  });

  test("accepts all valid providers", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });

    for (const provider of ["local", "gemini", "openai", "elevenlabs"] as const) {
      writeFileSync(
        join(piDir, "pi-voice.json"),
        JSON.stringify({ provider }),
      );
      const config = loadConfig(tmpDir);
      expect(config.provider).toBe(provider);
    }
  });

  test("throws ConfigError on invalid JSON syntax", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "pi-voice.json"), "not json {{{");

    expect(() => loadConfig(tmpDir)).toThrow(ConfigError);
    try {
      loadConfig(tmpDir);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).details).toContain("JSON parse error");
    }
  });

  test("throws ConfigError for a non-object JSON config", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "pi-voice.json"), "null");

    expect(() => loadConfig(tmpDir)).toThrow(ConfigError);
  });

  test("throws ConfigError on invalid provider", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, "pi-voice.json"),
      JSON.stringify({ provider: "invalid-provider" }),
    );

    expect(() => loadConfig(tmpDir)).toThrow(ConfigError);
  });

  test("throws ConfigError on invalid key binding", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, "pi-voice.json"),
      JSON.stringify({ key: "unknownkey" }),
    );

    expect(() => loadConfig(tmpDir)).toThrow(ConfigError);
  });

  test("ConfigError includes configPath and details", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const configPath = join(piDir, "pi-voice.json");
    writeFileSync(configPath, "bad json");

    try {
      loadConfig(tmpDir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const ce = err as ConfigError;
      expect(ce.configPath).toBe(configPath);
      expect(ce.details).toBeDefined();
      expect(ce.name).toBe("ConfigError");
    }
  });
});

describe("Global User Config Persistence & Overlay Suite", () => {
  let testRoot: string;
  let dirA: string;
  let dirB: string;
  let origHome: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `pi-voice-global-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dirA = join(testRoot, "project-a");
    dirB = join(testRoot, "project-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    origHome = process.env.HOME;
    process.env.HOME = join(testRoot, "home");
  });

  afterEach(() => {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  test("updateConfig always writes patches to canonical global user config path", () => {
    const globalPath = getUserConfigPath();
    expect(existsSync(globalPath)).toBe(false);

    updateConfig(dirA, {
      key: "ctrl+shift+p",
      editKey: "ctrl+shift+e",
      provider: "openai",
      geminiModel: "gemini-2.5-flash",
      inputGain: 1.75,
      dictationPreset: "email_polish",
      dictationMode: "hold",
      translateEnabled: true,
      targetLanguage: "German",
      audioChimesEnabled: false,
      chimeSoundStart: "pop",
      chimeSoundEnd: "tink",
      transcriptionDelaySec: 1.5,
      autoEndpointEnabled: false,
      geminiApiKey: "sk-test-secret-key-12345",
    });

    expect(existsSync(globalPath)).toBe(true);
    const content = JSON.parse(readFileSync(globalPath, "utf-8"));

    expect(content.key).toBe("ctrl+shift+p");
    expect(content.editKey).toBe("ctrl+shift+e");
    expect(content.provider).toBe("openai");
    expect(content.geminiModel).toBe("gemini-2.5-flash");
    expect(content.inputGain).toBe(1.75);
    expect(content.dictationPreset).toBe("email_polish");
    expect(content.dictationMode).toBe("hold");
    expect(content.translateEnabled).toBe(true);
    expect(content.targetLanguage).toBe("German");
    expect(content.audioChimesEnabled).toBe(false);
    expect(content.chimeSoundStart).toBe("pop");
    expect(content.chimeSoundEnd).toBe("tink");
    expect(content.transcriptionDelaySec).toBe(1.5);
    expect(content.autoEndpointEnabled).toBe(false);
    expect(content.geminiApiKey).toBeDefined();
  });

  test("updateConfig updates project-local .pi/pi-voice.json if present, but does not create it if absent", () => {
    // 1. Without project config in dirA
    const projPathA = getProjConfigPath(dirA)!;
    expect(existsSync(projPathA)).toBe(false);

    updateConfig(dirA, { inputGain: 1.2 });
    expect(existsSync(projPathA)).toBe(false);

    // 2. With project config in dirB
    const projDirB = join(dirB, ".pi");
    mkdirSync(projDirB, { recursive: true });
    const projPathB = getProjConfigPath(dirB)!;
    writeFileSync(projPathB, JSON.stringify({ dictationPreset: "code_comment" }));

    updateConfig(dirB, { inputGain: 1.6 });

    expect(existsSync(projPathB)).toBe(true);
    const projContent = JSON.parse(readFileSync(projPathB, "utf-8"));
    expect(projContent.inputGain).toBe(1.6);
    expect(projContent.dictationPreset).toBe("code_comment");
  });

  test("loadConfig uses global user config as baseline and overlays project-local overrides", () => {
    // Write global config baseline
    updateConfig(dirA, {
      provider: "openai",
      inputGain: 1.8,
      dictationPreset: "careful",
      targetLanguage: "French",
    });

    // Create project-local override in dirB
    const projDirB = join(dirB, ".pi");
    mkdirSync(projDirB, { recursive: true });
    writeFileSync(join(projDirB, "pi-voice.json"), JSON.stringify({ dictationPreset: "code_comment" }));

    // loadConfig(dirB) should have global provider, inputGain, targetLanguage, but project's dictationPreset
    const loadedB = loadConfig(dirB);
    expect(loadedB.provider).toBe("openai");
    expect(loadedB.inputGain).toBe(1.8);
    expect(loadedB.targetLanguage).toBe("French");
    expect(loadedB.dictationPreset).toBe("code_comment");
  });

  test("guarantees user setting changes persist losslessly across directory changes and app launches", () => {
    // Save settings from dirA
    updateConfig(dirA, {
      key: "ctrl+shift+u",
      editKey: "ctrl+shift+k",
      provider: "gemini",
      geminiModel: "gemini-2.5-flash",
      inputGain: 1.4,
      dictationPreset: "fast",
      dictationMode: "hold",
      translateEnabled: true,
      targetLanguage: "Spanish",
      transcriptionDelaySec: 2.0,
      autoEndpointEnabled: false,
      geminiApiKey: "my-custom-api-key",
      audioChimesEnabled: false,
      chimeSoundStart: "hero",
      chimeSoundEnd: "ping",
    });

    // Load config from dirB (which has no .pi/pi-voice.json)
    const loadedB = loadConfig(dirB);
    expect(loadedB.keyDisplay).toBeDefined();
    expect(loadedB.provider).toBe("gemini");
    expect(loadedB.geminiModel).toBe("gemini-2.5-flash");
    expect(loadedB.inputGain).toBe(1.4);
    expect(loadedB.dictationPreset).toBe("fast");
    expect(loadedB.dictationMode).toBe("hold");
    expect(loadedB.translateEnabled).toBe(true);
    expect(loadedB.targetLanguage).toBe("Spanish");
    expect(loadedB.transcriptionDelaySec).toBe(2.0);
    expect(loadedB.autoEndpointEnabled).toBe(false);
    expect(loadedB.geminiApiKey).toBe("my-custom-api-key");
    expect(loadedB.audioChimesEnabled).toBe(false);
    expect(loadedB.chimeSoundStart).toBe("hero");
    expect(loadedB.chimeSoundEnd).toBe("ping");

    // Load config simulating app launch from / or /Applications/vo.app
    const loadedRoot = loadConfig("/");
    expect(loadedRoot.provider).toBe("gemini");
    expect(loadedRoot.inputGain).toBe(1.4);
    expect(loadedRoot.dictationPreset).toBe("fast");
    expect(loadedRoot.targetLanguage).toBe("Spanish");
    expect(loadedRoot.geminiApiKey).toBe("my-custom-api-key");
  });
});
