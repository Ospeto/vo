import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, statSync, chmodSync } from "node:fs";
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

// Keep config tests from writing the real user's module-load-time vocabulary path.
mock.module("../../services/vocabulary-service.js", () => ({
  loadPersistedVocabulary: () => ({ customVocabulary: [], presetVocabulary: {}, entries: [] }),
  savePersistedVocabulary: () => {},
  migrateVocabulary: (customVocabulary: string[], presetVocabulary: Record<string, string[]>, entries: unknown[] = []) => entries,
  backfillLegacyWhitespace: (entries: unknown[]) => entries,
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
  SecretStoreError,
  setSafeStorageProvider,
  configPatchSchema,
} from "../../services/config.js";
import { getSanitizedSettingsConfig } from "../../services/ipc-policy.js";

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
  let origXdg: string | undefined;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pi-voice-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    origHome = process.env.HOME;
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = join(tmpDir, "home");
    process.env.XDG_CONFIG_HOME = join(tmpDir, "home", ".config");
  });

  afterEach(() => {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
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

  test("auto-recovers corrupt JSON syntax to defaultConfig and preserves a unique backup", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const brokenPath = join(piDir, "pi-voice.json");
    writeFileSync(brokenPath, "not json {{{");

    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("gemini");
    expect(config.dictationPreset).toBe("careful");

    const backup = readdirSync(piDir).find((name) => name.startsWith("pi-voice.json.corrupt."));
    expect(backup).toBeDefined();
    expect(readFileSync(join(piDir, backup!), "utf8")).toBe("not json {{{");
    expect(existsSync(brokenPath)).toBe(false);
  });

  test("auto-recovers non-object JSON config to defaultConfig and renames file", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const brokenPath = join(piDir, "pi-voice.json");
    writeFileSync(brokenPath, "null");

    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("gemini");
    expect(readdirSync(piDir).some((name) => name.startsWith("pi-voice.json.corrupt."))).toBe(true);
  });

  test("auto-heals legacy model names like gemini-1.5-flash to valid models without throwing", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const configPath = join(piDir, "pi-voice.json");
    writeFileSync(configPath, JSON.stringify({ geminiModel: "gemini-1.5-flash", inputGain: 1.25 }));

    const config = loadConfig(tmpDir);
    expect(config.geminiModel).toBe("gemini-3.1-flash-lite");
    expect(config.inputGain).toBe(1.25);

    const updatedRaw = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(updatedRaw.geminiModel).toBe("gemini-3.1-flash-lite");
  });

  test("repairs global and project configs independently", () => {
    const globalPath = getUserConfigPath();
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const projectPath = join(piDir, "pi-voice.json");
    mkdirSync(join(tmpDir, "home", ".config", "pi-voice"), { recursive: true });
    writeFileSync(globalPath, JSON.stringify({ geminiModel: "gemini-1.5-flash", geminiApiKey: "secret" }));
    writeFileSync(projectPath, JSON.stringify({ dictationPreset: "code_comment" }));

    expect(loadConfig(tmpDir).geminiModel).toBe("gemini-3.1-flash-lite");
    expect(JSON.parse(readFileSync(projectPath, "utf-8"))).toEqual({ dictationPreset: "code_comment" });
    expect(JSON.parse(readFileSync(globalPath, "utf-8")).geminiApiKey).toBe("secret");
  });

  test("uses valid global settings after recovering a corrupt project config", () => {
    const globalPath = getUserConfigPath();
    mkdirSync(join(tmpDir, "home", ".config", "pi-voice"), { recursive: true });
    writeFileSync(globalPath, JSON.stringify({ provider: "openai", inputGain: 1.5 }));
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "pi-voice.json"), "broken");

    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("openai");
    expect(config.inputGain).toBe(1.5);
  });

  test("falls back to the legacy user config when XDG config is absent", () => {
    const legacyPath = join(tmpDir, "home", ".config", "pi-voice", "config.json");
    mkdirSync(join(tmpDir, "home", ".config", "pi-voice"), { recursive: true });
    process.env.XDG_CONFIG_HOME = join(tmpDir, "xdg");
    writeFileSync(legacyPath, JSON.stringify({ provider: "openai" }));

    expect(loadConfig(tmpDir).provider).toBe("openai");
  });

  test("falls back to a valid legacy config after backing up corrupt XDG config", () => {
    const legacyPath = join(tmpDir, "home", ".config", "pi-voice", "config.json");
    const xdgPath = join(tmpDir, "xdg", "pi-voice", "config.json");
    mkdirSync(join(tmpDir, "home", ".config", "pi-voice"), { recursive: true });
    mkdirSync(join(tmpDir, "xdg", "pi-voice"), { recursive: true });
    process.env.XDG_CONFIG_HOME = join(tmpDir, "xdg");
    writeFileSync(legacyPath, JSON.stringify({ provider: "openai" }));
    writeFileSync(xdgPath, "broken");

    expect(loadConfig(tmpDir).provider).toBe("openai");
    expect(existsSync(xdgPath)).toBe(false);
  });

  test("keeps prior corrupt backups", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const brokenPath = join(piDir, "pi-voice.json");
    writeFileSync(brokenPath, "first");
    loadConfig(tmpDir);
    writeFileSync(brokenPath, "second");
    loadConfig(tmpDir);

    expect(readdirSync(piDir).filter((name) => name.startsWith("pi-voice.json.corrupt.")).length).toBe(2);
  });

  test("auto-heals invalid provider and invalid key binding without throwing", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const configPath = join(piDir, "pi-voice.json");
    writeFileSync(
      configPath,
      JSON.stringify({ provider: "invalid-provider", key: "unknownkey", inputGain: 1.5 }),
    );

    const config = loadConfig(tmpDir);
    expect(config.provider).toBe("gemini");
    expect(config.inputGain).toBe(1.5);
    expect(config.key.ctrl).toBe(true);

    const updatedRaw = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(updatedRaw.provider).toBeUndefined();
    expect(updatedRaw.key).toBeUndefined();
    expect(updatedRaw.inputGain).toBe(1.5);
  });

  test("app startup never crashes on malformed, old, or invalid config files", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });

    const badConfigs = [
      "bad json {",
      "123",
      "[]",
      JSON.stringify({ geminiModel: "gemini-1.5-pro", dictationPreset: "translate" }),
      JSON.stringify({ key: "bad+binding", obsoleteField: "foo" }),
    ];

    for (const badContent of badConfigs) {
      writeFileSync(join(piDir, "pi-voice.json"), badContent);
      expect(() => loadConfig(tmpDir)).not.toThrow();
    }
  });
});

describe("Global User Config Persistence & Overlay Suite", () => {
  let testRoot: string;
  let dirA: string;
  let dirB: string;
  let origHome: string | undefined;
  let origXdg: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `pi-voice-global-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dirA = join(testRoot, "project-a");
    dirB = join(testRoot, "project-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    origHome = process.env.HOME;
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = join(testRoot, "home");
    process.env.XDG_CONFIG_HOME = join(testRoot, "home", ".config");

    setSafeStorageProvider({
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(`MOCK_ENC:${plainText}`),
      decryptString: (cipherText: Buffer) => {
        const str = cipherText.toString("utf-8");
        if (str.startsWith("MOCK_ENC:")) return str.slice(9);
        return str;
      },
      getSelectedStorageBackend: () => "gnome_libsecret",
    });
  });

  afterEach(() => {
    setSafeStorageProvider(null);
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
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

  test("preserves valid legacy settings when updating over corrupt XDG config", () => {
    const legacyPath = join(testRoot, "home", ".config", "pi-voice", "config.json");
    const xdgPath = join(testRoot, "xdg", "pi-voice", "config.json");
    mkdirSync(join(testRoot, "home", ".config", "pi-voice"), { recursive: true });
    mkdirSync(join(testRoot, "xdg", "pi-voice"), { recursive: true });
    process.env.XDG_CONFIG_HOME = join(testRoot, "xdg");
    writeFileSync(legacyPath, JSON.stringify({ provider: "openai", inputGain: 1.7 }));
    writeFileSync(xdgPath, "broken");

    const updated = updateConfig(dirA, { targetLanguage: "French" });
    expect(updated.provider).toBe("openai");
    expect(updated.inputGain).toBe(1.7);
    expect(updated.targetLanguage).toBe("French");
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

  test("clears geminiApiKey and geminiFallbackApiKey cleanly when empty string is passed to updateConfig", () => {
    updateConfig(dirA, {
      geminiApiKey: "some-key",
      geminiFallbackApiKey: "some-fallback-key",
    });
    const loadedWithKeys = loadConfig(dirA);
    expect(loadedWithKeys.geminiApiKey).toBe("some-key");
    expect(loadedWithKeys.geminiFallbackApiKey).toBe("some-fallback-key");

    updateConfig(dirA, {
      geminiApiKey: "",
      geminiFallbackApiKey: " ",
    });
    const loadedCleared = loadConfig(dirA);
    expect(loadedCleared.geminiApiKey).toBeUndefined();
    expect(loadedCleared.geminiFallbackApiKey).toBeUndefined();
  });
});

describe("PR-04 Secret Persistence, Type Safety & Hardening Suite", () => {
  let testRoot: string;
  let dirProj: string;
  let origHome: string | undefined;
  let origXdg: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `pi-voice-pr04-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dirProj = join(testRoot, "project-test");
    mkdirSync(dirProj, { recursive: true });

    origHome = process.env.HOME;
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = join(testRoot, "home");
    process.env.XDG_CONFIG_HOME = join(testRoot, "home", ".config");

    setSafeStorageProvider({
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(`MOCK_ENC:${plainText}`),
      decryptString: (cipherText: Buffer) => {
        const str = cipherText.toString("utf-8");
        if (str.startsWith("MOCK_ENC:")) return str.slice(9);
        throw new Error("Decryption failed");
      },
      getSelectedStorageBackend: () => "gnome_libsecret",
    });
  });

  afterEach(() => {
    setSafeStorageProvider(null);
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  test("1. Save and clear never write secret fields to project config (.pi/pi-voice.json)", () => {
    const projDir = join(dirProj, ".pi");
    mkdirSync(projDir, { recursive: true });
    const projPath = join(projDir, "pi-voice.json");
    writeFileSync(projPath, JSON.stringify({ dictationPreset: "careful" }));

    updateConfig(dirProj, {
      geminiApiKey: "AIzaSyTestSecret123",
      geminiFallbackApiKey: "AIzaSyFallbackSecret456",
      dictationPreset: "fast",
    });

    const userPath = getUserConfigPath();
    expect(existsSync(userPath)).toBe(true);
    const userContent = JSON.parse(readFileSync(userPath, "utf-8"));
    expect(userContent.geminiApiKey).toBe("enc:TU9DS19FTkM6QUl6YVN5VGVzdFNlY3JldDEyMw==");
    expect(userContent.geminiFallbackApiKey).toBe("enc:TU9DS19FTkM6QUl6YVN5RmFsbGJhY2tTZWNyZXQ0NTY=");

    const projContent = JSON.parse(readFileSync(projPath, "utf-8"));
    expect(projContent.dictationPreset).toBe("fast");
    expect(projContent.geminiApiKey).toBeUndefined();
    expect(projContent.geminiFallbackApiKey).toBeUndefined();

    // Clear keys
    updateConfig(dirProj, { geminiApiKey: "", geminiFallbackApiKey: "" });
    const projContentAfterClear = JSON.parse(readFileSync(projPath, "utf-8"));
    expect(projContentAfterClear.geminiApiKey).toBeUndefined();
    expect(projContentAfterClear.geminiFallbackApiKey).toBeUndefined();

    const userContentAfterClear = JSON.parse(readFileSync(userPath, "utf-8"));
    expect(userContentAfterClear.geminiApiKey).toBeUndefined();
    expect(userContentAfterClear.geminiFallbackApiKey).toBeUndefined();
  });

  test("2. Plaintext legacy project key migration is ordered and idempotent", () => {
    const projDir = join(dirProj, ".pi");
    mkdirSync(projDir, { recursive: true });
    const projPath = join(projDir, "pi-voice.json");
    writeFileSync(projPath, JSON.stringify({ geminiApiKey: "legacy-proj-secret-key", inputGain: 1.5 }));

    const loaded = loadConfig(dirProj);
    expect(loaded.geminiApiKey).toBe("legacy-proj-secret-key");

    // Verify project file has project key removed
    const projContent = JSON.parse(readFileSync(projPath, "utf-8"));
    expect(projContent.geminiApiKey).toBeUndefined();
    expect(projContent.inputGain).toBe(1.5);

    // Verify user file has encrypted key
    const userContent = JSON.parse(readFileSync(getUserConfigPath(), "utf-8"));
    expect(userContent.geminiApiKey).toBe("enc:TU9DS19FTkM6bGVnYWN5LXByb2otc2VjcmV0LWtleQ==");

    // Second call is idempotent
    const reloaded = loadConfig(dirProj);
    expect(reloaded.geminiApiKey).toBe("legacy-proj-secret-key");
    const projContentSecond = JSON.parse(readFileSync(projPath, "utf-8"));
    expect(projContentSecond.geminiApiKey).toBeUndefined();
  });

  test("3. basic_text and encryption failure write nothing to disk and abort key write", () => {
    const origPlat = process.platform;
    try {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      setSafeStorageProvider({
        isEncryptionAvailable: () => true,
        encryptString: () => Buffer.from("weak"),
        decryptString: () => "weak",
        getSelectedStorageBackend: () => "basic_text",
      });

      expect(() => {
        updateConfig(dirProj, { geminiApiKey: "do-not-save-plaintext" });
      }).toThrow(SecretStoreError);

      expect(existsSync(getUserConfigPath())).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", { value: origPlat, configurable: true });
    }

    setSafeStorageProvider({
      isEncryptionAvailable: () => true,
      encryptString: () => { throw new Error("OS Keychain Error"); },
      decryptString: () => "",
      getSelectedStorageBackend: () => "gnome_libsecret",
    });

    expect(() => {
      updateConfig(dirProj, { geminiApiKey: "do-not-save-keychain-fail" });
    }).toThrow(SecretStoreError);

    expect(existsSync(getUserConfigPath())).toBe(false);
  });

  test("4. Malformed ciphertext survives unrelated patch and reports decrypt error", () => {
    const userPath = getUserConfigPath();
    mkdirSync(join(testRoot, "home", ".config", "pi-voice"), { recursive: true });
    writeFileSync(userPath, JSON.stringify({ geminiApiKey: "enc:BAD_CIPHERTEXT", inputGain: 1.0 }), { mode: 0o600 });

    setSafeStorageProvider({
      isEncryptionAvailable: () => true,
      encryptString: (str: string) => Buffer.from(`MOCK_ENC:${str}`),
      decryptString: () => { throw new Error("Corrupted payload"); },
    });

    const loaded = loadConfig(dirProj);
    expect(loaded.geminiApiKey).toBeUndefined();
    expect(loaded.geminiKeyError).toBe("Failed to decrypt API key");

    updateConfig(dirProj, { inputGain: 1.8 });

    const userContent = JSON.parse(readFileSync(userPath, "utf-8"));
    expect(userContent.geminiApiKey).toBe("enc:BAD_CIPHERTEXT");

    const reloaded = loadConfig(dirProj);
    expect(reloaded.geminiApiKey).toBeUndefined();
    expect(reloaded.geminiKeyError).toBe("Failed to decrypt API key");
  });

  test("5. Wrong-account decrypt differs from absent key in settings payload", () => {
    const loadedAbsent = loadConfig(dirProj);
    const settingsAbsent = getSanitizedSettingsConfig(loadedAbsent);
    expect(settingsAbsent.hasGeminiKey).toBe(false);
    expect(settingsAbsent.geminiKeyError).toBeUndefined();

    const userPath = getUserConfigPath();
    mkdirSync(join(testRoot, "home", ".config", "pi-voice"), { recursive: true });
    writeFileSync(userPath, JSON.stringify({ geminiApiKey: "enc:WRONG_ACCOUNT_KEY" }), { mode: 0o600 });

    setSafeStorageProvider({
      isEncryptionAvailable: () => true,
      encryptString: (str: string) => Buffer.from(`MOCK_ENC:${str}`),
      decryptString: () => { throw new Error("Mac Keychain Access Denied"); },
    });

    const loadedError = loadConfig(dirProj);
    const settingsError = getSanitizedSettingsConfig(loadedError);
    expect(settingsError.hasGeminiKey).toBe(false);
    expect(settingsError.geminiKeyError).toBe("Failed to decrypt API key");
  });

  test("6. Strict IPC patch schema rejects unknown keys, wrong types, nulls, and excessive data", () => {
    expect(configPatchSchema.safeParse({ unknownField: 123 }).success).toBe(false);
    expect(configPatchSchema.safeParse({ inputGain: "not-a-number" }).success).toBe(false);
    expect(configPatchSchema.safeParse({ provider: null }).success).toBe(false);
    expect(configPatchSchema.safeParse({ geminiApiKey: "a".repeat(1001) }).success).toBe(false);

    expect(configPatchSchema.safeParse({ geminiApiKey: "" }).success).toBe(true);
    expect(configPatchSchema.safeParse({ inputGain: 1.5 }).success).toBe(true);
    expect(configPatchSchema.safeParse({}).success).toBe(true);
  });

  test("7. Valid clear behavior removes secret keys cleanly", () => {
    updateConfig(dirProj, { geminiApiKey: "AIzaSyToClear" });
    expect(loadConfig(dirProj).geminiApiKey).toBe("AIzaSyToClear");

    updateConfig(dirProj, { geminiApiKey: "" });
    const cleared = loadConfig(dirProj);
    expect(cleared.geminiApiKey).toBeUndefined();
    expect(cleared.geminiKeyError).toBeUndefined();
  });

  test("8. User config writes enforce mode 0600 on creation and rewrite", () => {
    updateConfig(dirProj, { geminiApiKey: "AIzaSyPermTest" });
    const userPath = getUserConfigPath();
    expect(existsSync(userPath)).toBe(true);

    const mode = statSync(userPath).mode & 0o777;
    expect(mode).toBe(0o600);

    updateConfig(dirProj, { inputGain: 1.4 });
    const rewrittenMode = statSync(userPath).mode & 0o777;
    expect(rewrittenMode).toBe(0o600);
  });
});

describe("PR-05 Unified Corrupt-Config Remediation & Recovery Suite", () => {
  let testRoot: string;
  let userDir: string;
  let projDir: string;
  let originalHome: string | undefined;
  let originalXdg: string | undefined;

  beforeEach(() => {
    testRoot = join(tmpdir(), `pi-voice-pr05-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    userDir = join(testRoot, "home", ".config", "pi-voice");
    projDir = join(testRoot, "project");

    mkdirSync(userDir, { recursive: true });
    mkdirSync(join(projDir, ".pi"), { recursive: true });

    originalHome = process.env.HOME;
    originalXdg = process.env.XDG_CONFIG_HOME;

    process.env.HOME = join(testRoot, "home");
    process.env.XDG_CONFIG_HOME = join(testRoot, "home", ".config");
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;

    if (originalXdg !== undefined) process.env.XDG_CONFIG_HOME = originalXdg;
    else delete process.env.XDG_CONFIG_HOME;

    rmSync(testRoot, { recursive: true, force: true });
  });

  test("1. Truncated user and project files are backed up and updateConfig completes successfully", () => {
    const userPath = join(userDir, "config.json");
    const projPath = join(projDir, ".pi", "pi-voice.json");

    writeFileSync(userPath, '{"provider": "openai", "dictation');
    writeFileSync(projPath, '{"inputGain": ');

    const updated = updateConfig(projDir, { dictationPreset: "code_comment" });
    expect(updated.dictationPreset).toBe("code_comment");

    const userBackups = readdirSync(userDir).filter((name) => name.includes(".corrupt"));
    const projBackups = readdirSync(join(projDir, ".pi")).filter((name) => name.includes(".corrupt"));

    expect(userBackups.length).toBeGreaterThanOrEqual(1);
    expect(projBackups.length).toBeGreaterThanOrEqual(1);

    expect(readFileSync(join(userDir, userBackups[0]!), "utf-8")).toBe('{"provider": "openai", "dictation');
    expect(readFileSync(join(projDir, ".pi", projBackups[0]!), "utf-8")).toBe('{"inputGain": ');
  });

  test("2. Unrelated patches preserve clean options when updating over corrupt config", () => {
    const userPath = join(userDir, "config.json");
    writeFileSync(userPath, "corrupt json syntax {{{");

    const updated = updateConfig(projDir, { editKey: "option+k", inputGain: 1.8 });
    expect(updated.editKey.keycode).toBe(loadConfig(projDir).editKey.keycode);
    expect(updated.inputGain).toBe(1.8);

    const userBackups = readdirSync(userDir).filter((name) => name.includes(".corrupt"));
    expect(userBackups.length).toBe(1);
    expect(readFileSync(join(userDir, userBackups[0]!), "utf-8")).toBe("corrupt json syntax {{{");
  });

  test("3. Byte-identical backup preservation", () => {
    const userPath = join(userDir, "config.json");
    const binaryCorruptData = Buffer.from([0x7b, 0x22, 0x62, 0x61, 0x64, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    writeFileSync(userPath, binaryCorruptData);

    loadConfig(projDir);

    const userBackups = readdirSync(userDir).filter((name) => name.includes(".corrupt"));
    expect(userBackups.length).toBe(1);
    const backupContent = readFileSync(join(userDir, userBackups[0]!));
    expect(backupContent.equals(binaryCorruptData)).toBe(true);
  });

  test("4. Safe repaired output for legacy fields vs typed refusal on failed backup", () => {
    const userPath = join(userDir, "config.json");

    // Safe repaired output
    writeFileSync(userPath, JSON.stringify({ geminiModel: "gemini-1.5-flash", inputGain: 1.25 }));
    const repaired = loadConfig(projDir);
    expect(repaired.geminiModel).toBe("gemini-3.1-flash-lite");

    const onDiskRaw = JSON.parse(readFileSync(userPath, "utf-8"));
    expect(onDiskRaw.geminiModel).toBe("gemini-3.1-flash-lite");

    // Typed refusal when backup fails
    writeFileSync(userPath, "corrupt {{{");

    const fsModule = require("node:fs").default || require("node:fs");
    const originalOpen = fsModule.openSync;
    try {
      fsModule.openSync = (path: string, ...args: unknown[]) => {
        if (path.includes(".corrupt")) throw new Error("EACCES: permission denied, open");
        return originalOpen(path, ...args);
      };

      expect(() => updateConfig(projDir, { inputGain: 1.5 })).toThrow(/Failed to backup corrupt user config file/);
      expect(readFileSync(userPath, "utf-8")).toBe("corrupt {{{");
    } finally {
      fsModule.openSync = originalOpen;
    }
  });

  test("5. Backup rename/write failure leaves corrupt file untouched and rejects update", () => {
    const userPath = join(userDir, "config.json");
    const projPath = join(projDir, ".pi", "pi-voice.json");

    writeFileSync(userPath, "valid json object");
    writeFileSync(userPath, "{ invalid json syntax");
    writeFileSync(projPath, "{ bad project syntax");

    const fsModule = require("node:fs").default || require("node:fs");
    const originalOpen = fsModule.openSync;
    try {
      fsModule.openSync = (path: string, ...args: unknown[]) => {
        if (path.includes("pi-voice.json.corrupt")) {
          throw new Error("EROFS: read-only file system");
        }
        return originalOpen(path, ...args);
      };

      expect(() => updateConfig(projDir, { inputGain: 1.2 })).toThrow(ConfigError);
      expect(readFileSync(projPath, "utf-8")).toBe("{ bad project syntax");
    } finally {
      fsModule.openSync = originalOpen;
    }
  });

  test("6. Sequential saves create distinct collision-free backup files", () => {
    const userPath = join(userDir, "config.json");

    writeFileSync(userPath, "corrupt content 1");
    loadConfig(projDir);

    writeFileSync(userPath, "corrupt content 2");
    loadConfig(projDir);

    const backups = readdirSync(userDir).filter((name) => name.includes(".corrupt"));
    expect(backups.length).toBe(2);

    const contents = backups.map((b) => readFileSync(join(userDir, b), "utf-8"));
    expect(contents).toContain("corrupt content 1");
    expect(contents).toContain("corrupt content 2");
  });

  test("7. Enforces mode 0600 permissions on active and corrupt user config files", () => {
    const userPath = join(userDir, "config.json");
    writeFileSync(userPath, '{"geminiApiKey":"plaintext-secret", broken');
    chmodSync(userPath, 0o644);

    updateConfig(projDir, { inputGain: 1.3 });

    expect(existsSync(userPath)).toBe(true);
    expect(statSync(userPath).mode & 0o777).toBe(0o600);
    const backup = readdirSync(userDir).find((name) => name.includes(".corrupt"));
    expect(backup).toBeDefined();
    expect(statSync(join(userDir, backup!)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(userDir, backup!), "utf8")).toContain("plaintext-secret");
  });

  test("8. Concurrent recovery preserves the original corrupt bytes", async () => {
    const userPath = join(userDir, "config.json");
    const original = '{"provider":"gemini", BROKEN ORIGINAL';
    writeFileSync(userPath, original);
    mkdirSync(join(testRoot, "markers"), { recursive: true });

    const worker = join(import.meta.dir, "..", "fixtures", "config-recovery-worker.ts");
    const env = {
      ...process.env,
      HOME: join(testRoot, "home"),
      XDG_CONFIG_HOME: join(testRoot, "home", ".config"),
    };
    const a = Bun.spawn(["bun", worker, "A", testRoot], { env, stdout: "pipe", stderr: "pipe" });
    const b = Bun.spawn(["bun", worker, "B", testRoot], { env, stdout: "pipe", stderr: "pipe" });
    const [aExit, bExit] = await Promise.all([a.exited, b.exited]);

    expect(aExit).toBe(0);
    expect(bExit).toBe(0);
    const backups = readdirSync(userDir).filter((name) => name.includes(".corrupt"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(userDir, backups[0]!), "utf8")).toBe(original);
    const saved = JSON.parse(readFileSync(userPath, "utf8"));
    expect(saved.inputGain).toBe(1.1);
    expect(saved.targetLanguage).toBe("French");
    expect(readdirSync(userDir).some((name) => name.endsWith(".tmp") || name.endsWith(".ready"))).toBe(false);
  });

  test("9. Repairs malformed nested records without deleting valid siblings", () => {
    const userPath = join(userDir, "config.json");
    writeFileSync(userPath, JSON.stringify({
      targetLanguage: "French",
      appPresetMappings: { "custom-editor": "fast", broken: "bogus" },
      presetVocabulary: { careful: ["alpha", 42, "beta"] },
    }));

    const updated = updateConfig(projDir, { inputGain: 1.4 });
    const onDisk = JSON.parse(readFileSync(userPath, "utf8"));

    expect(updated.targetLanguage).toBe("French");
    expect(updated.appPresetMappings?.["custom-editor"]).toBe("fast");
    expect(onDisk.appPresetMappings).toEqual({ "custom-editor": "fast" });
    expect(onDisk.presetVocabulary.careful).toEqual(["alpha", "beta"]);
  });

  test("timeout cleanup closes stdin and reaps the full lock helper", async () => {
    const worker = join(import.meta.dir, "..", "fixtures", "config-recovery-worker.ts");
    const process = Bun.spawn(["bun", worker, "timeout", testRoot], {
      env: { ...globalThis.process.env, NODE_ENV: "test", VO_CONFIG_LOCK_TIMEOUT_MS: "500" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const pidPath = join(testRoot, "helper-pid");
    for (let attempt = 0; attempt < 100 && !existsSync(pidPath); attempt++) await Bun.sleep(5);
    const helperPid = Number(readFileSync(pidPath, "utf8"));
    let descendantStarted = false;
    for (let attempt = 0; attempt < 100 && !descendantStarted; attempt++) {
      const processes = Bun.spawnSync(["ps", "-axo", "pid=,pgid=,comm="]).stdout.toString();
      descendantStarted = processes.split("\n").some((line) => {
        const [, pgid, command] = line.trim().split(/\s+/, 3);
        return Number(pgid) === helperPid && command?.endsWith("cat");
      });
      if (!descendantStarted) await Bun.sleep(10);
    }
    writeFileSync(join(testRoot, "cat-confirmed"), "");
    expect(descendantStarted).toBe(true);

    expect(await process.exited).toBe(0);
    expect(JSON.parse(await new Response(process.stdout).text())).toEqual({
      timedOut: true,
      stdinDestroyed: true,
      reaped: true,
      groupGone: true,
    });
  });

  test("10. Later project backup failure restores earlier user recovery", () => {
    const userPath = join(userDir, "config.json");
    const projPath = join(projDir, ".pi", "pi-voice.json");
    const userCorrupt = "{ broken user";
    const projectCorrupt = "{ broken project";
    writeFileSync(userPath, userCorrupt);
    writeFileSync(projPath, projectCorrupt);

    const fsModule = require("node:fs").default || require("node:fs");
    const originalOpen = fsModule.openSync;
    try {
      fsModule.openSync = (path: string, ...args: unknown[]) => {
        if (path.includes("pi-voice.json.corrupt")) {
          throw new Error("EROFS: read-only file system");
        }
        return originalOpen(path, ...args);
      };

      expect(() => updateConfig(projDir, { inputGain: 1.2 })).toThrow(ConfigError);
    } finally {
      fsModule.openSync = originalOpen;
    }

    expect(readFileSync(userPath, "utf8")).toBe(userCorrupt);
    expect(readFileSync(projPath, "utf8")).toBe(projectCorrupt);
    expect(readdirSync(userDir).filter((name) => name.includes(".corrupt"))).toHaveLength(0);
    expect(readdirSync(join(projDir, ".pi")).filter((name) => name.includes(".corrupt"))).toHaveLength(0);
  });
});
