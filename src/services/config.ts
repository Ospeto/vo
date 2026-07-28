import { join, dirname } from "node:path";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { UiohookKey } from "uiohook-napi";
import { z } from "zod";
import logger from "./logger.js";
import { loadPersistedVocabulary, savePersistedVocabulary } from "./vocabulary-service.js";

// ── Types ────────────────────────────────────────────────────────────

export interface KeyBinding {
  keycode: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type SpeechProvider = "local" | "gemini" | "openai" | "elevenlabs";
export type GeminiModelChoice = "gemini-3.1-flash-lite" | "gemini-2.5-flash";
export type DictationPreset = "auto" | "careful" | "code_comment" | "fast" | "email_polish" | "burmese_written" | "translate";
export type DictationMode = "toggle" | "hold";
export type ChimeSoundChoice = "glass" | "submarine" | "hero" | "ping" | "pop" | "tink";

export interface PiVoiceConfig {
  key: KeyBinding;
  keyDisplay: string;
  editKey: KeyBinding;
  editKeyDisplay: string;
  provider: SpeechProvider;
  geminiModel: GeminiModelChoice;
  inputGain: number;
  dictationPreset: DictationPreset;
  dictationMode: DictationMode;
  translateEnabled: boolean;
  targetLanguage: string;
  audioChimesEnabled: boolean;
  chimeSoundStart: ChimeSoundChoice;
  chimeSoundEnd: ChimeSoundChoice;
  symbolScannerEnabled: boolean;
  customVocabulary: string[];
  presetVocabulary: Partial<Record<DictationPreset, string[]>>;
  appPresetMappings?: Record<string, DictationPreset>;
  geminiApiKey?: string;
  geminiFallbackApiKey?: string;
  audioDeviceId?: string;
}

export interface PiVoiceConfigPatch {
  key?: string;
  editKey?: string;
  provider?: SpeechProvider;
  geminiModel?: GeminiModelChoice;
  inputGain?: number;
  dictationPreset?: DictationPreset;
  dictationMode?: DictationMode;
  translateEnabled?: boolean;
  targetLanguage?: string;
  audioChimesEnabled?: boolean;
  chimeSoundStart?: ChimeSoundChoice;
  chimeSoundEnd?: ChimeSoundChoice;
  symbolScannerEnabled?: boolean;
  customVocabulary?: string[];
  presetVocabulary?: Partial<Record<DictationPreset, string[]>>;
  appPresetMappings?: Record<string, DictationPreset>;
  geminiApiKey?: string;
  geminiFallbackApiKey?: string;
  audioDeviceId?: string;
}

// ── Key map ──────────────────────────────────────────────────────────

const KEY_MAP: Record<string, number> = {
  // Letters
  a: UiohookKey.A,
  b: UiohookKey.B,
  c: UiohookKey.C,
  d: UiohookKey.D,
  e: UiohookKey.E,
  f: UiohookKey.F,
  g: UiohookKey.G,
  h: UiohookKey.H,
  i: UiohookKey.I,
  j: UiohookKey.J,
  k: UiohookKey.K,
  l: UiohookKey.L,
  m: UiohookKey.M,
  n: UiohookKey.N,
  o: UiohookKey.O,
  p: UiohookKey.P,
  q: UiohookKey.Q,
  r: UiohookKey.R,
  s: UiohookKey.S,
  t: UiohookKey.T,
  u: UiohookKey.U,
  v: UiohookKey.V,
  w: UiohookKey.W,
  x: UiohookKey.X,
  y: UiohookKey.Y,
  z: UiohookKey.Z,

  // Numbers
  "0": UiohookKey["0"],
  "1": UiohookKey["1"],
  "2": UiohookKey["2"],
  "3": UiohookKey["3"],
  "4": UiohookKey["4"],
  "5": UiohookKey["5"],
  "6": UiohookKey["6"],
  "7": UiohookKey["7"],
  "8": UiohookKey["8"],
  "9": UiohookKey["9"],

  // Function keys
  f1: UiohookKey.F1,
  f2: UiohookKey.F2,
  f3: UiohookKey.F3,
  f4: UiohookKey.F4,
  f5: UiohookKey.F5,
  f6: UiohookKey.F6,
  f7: UiohookKey.F7,
  f8: UiohookKey.F8,
  f9: UiohookKey.F9,
  f10: UiohookKey.F10,
  f11: UiohookKey.F11,
  f12: UiohookKey.F12,

  // Special keys
  space: UiohookKey.Space,
  enter: UiohookKey.Enter,
  return: UiohookKey.Enter,
  escape: UiohookKey.Escape,
  esc: UiohookKey.Escape,
  tab: UiohookKey.Tab,
  backspace: UiohookKey.Backspace,
  delete: UiohookKey.Delete,
  insert: UiohookKey.Insert,
  home: UiohookKey.Home,
  end: UiohookKey.End,
  pageup: UiohookKey.PageUp,
  pagedown: UiohookKey.PageDown,

  // Arrow keys
  up: UiohookKey.ArrowUp,
  down: UiohookKey.ArrowDown,
  left: UiohookKey.ArrowLeft,
  right: UiohookKey.ArrowRight,
  arrowup: UiohookKey.ArrowUp,
  arrowdown: UiohookKey.ArrowDown,
  arrowleft: UiohookKey.ArrowLeft,
  arrowright: UiohookKey.ArrowRight,

  // Punctuation
  semicolon: UiohookKey.Semicolon,
  equal: UiohookKey.Equal,
  comma: UiohookKey.Comma,
  minus: UiohookKey.Minus,
  period: UiohookKey.Period,
  slash: UiohookKey.Slash,
  backquote: UiohookKey.Backquote,
  bracketleft: UiohookKey.BracketLeft,
  backslash: UiohookKey.Backslash,
  bracketright: UiohookKey.BracketRight,
  quote: UiohookKey.Quote,
};

export function parseKeyBinding(keyStr: string): KeyBinding {
  const parts = keyStr.toLowerCase().split("+").map((s) => s.trim());
  if (parts.length === 0 || parts.some((p) => p === "")) {
    throw new Error(`Invalid key binding: "${keyStr}"`);
  }

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let mainKey: string | null = null;

  for (const part of parts) {
    switch (part) {
      case "ctrl":
      case "control":
        ctrl = true;
        break;
      case "shift":
        shift = true;
        break;
      case "alt":
      case "opt":
      case "option":
        alt = true;
        break;
      case "meta":
      case "cmd":
      case "command":
      case "super":
      case "win":
        meta = true;
        break;
      default:
        if (mainKey !== null) {
          throw new Error(
            `Multiple non-modifier keys in key binding "${keyStr}": "${mainKey}" and "${part}"`,
          );
        }
        mainKey = part;
        break;
    }
  }

  if (mainKey === null) {
    throw new Error(`No non-modifier key specified in "${keyStr}"`);
  }

  const keycode = KEY_MAP[mainKey];
  if (keycode === undefined) {
    throw new Error(`Unknown key "${mainKey}" in key binding "${keyStr}"`);
  }

  return { keycode, ctrl, shift, alt, meta };
}

export function formatKeyDisplay(binding: KeyBinding): string {
  const isMac = process.platform === "darwin";
  const parts: string[] = [];

  if (binding.ctrl) parts.push(isMac ? "\u2303" : "Ctrl");
  if (binding.alt) parts.push(isMac ? "\u2325" : "Alt");
  if (binding.shift) parts.push(isMac ? "\u21E7" : "Shift");
  if (binding.meta) parts.push(isMac ? "\u2318" : "Win");

  const keyName = Object.entries(KEY_MAP).find(([, v]) => v === binding.keycode)?.[0]?.toUpperCase() ?? "?";
  parts.push(keyName);

  return parts.join(isMac ? "" : "+");
}

// ── Default config ───────────────────────────────────────────────────

// ── Default config ───────────────────────────────────────────────────

const DEFAULT_KEY_STRING = "ctrl+cmd+option+v";
const DEFAULT_EDIT_KEY_STRING = "ctrl+cmd+option+e";
const DEFAULT_PROVIDER: SpeechProvider = "gemini";
const DEFAULT_GEMINI_MODEL: GeminiModelChoice = "gemini-3.1-flash-lite";
const DEFAULT_INPUT_GAIN = 1.0;
const DEFAULT_DICTATION_PRESET: DictationPreset = "careful";
const DEFAULT_DICTATION_MODE: DictationMode = "toggle";
const DEFAULT_AUDIO_CHIMES_ENABLED = true;

export const DEFAULT_APP_PRESET_MAPPINGS: Record<string, DictationPreset> = {
  code: "code_comment",
  cursor: "code_comment",
  terminal: "code_comment",
  warp: "code_comment",
  iterm: "code_comment",
  ghostty: "code_comment",
  zed: "code_comment",
  sublime: "code_comment",
  slack: "careful",
  mail: "careful",
  outlook: "careful",
  telegram: "careful",
  teams: "careful",
  messages: "careful",
  obsidian: "careful",
  notion: "careful",
  bear: "careful",
  pages: "careful",
  word: "careful",
};

function defaultConfig(): PiVoiceConfig {
  const binding = parseKeyBinding(DEFAULT_KEY_STRING);
  const editBinding = parseKeyBinding(DEFAULT_EDIT_KEY_STRING);
  return {
    key: binding,
    keyDisplay: formatKeyDisplay(binding),
    editKey: editBinding,
    editKeyDisplay: formatKeyDisplay(editBinding),
    provider: DEFAULT_PROVIDER,
    geminiModel: DEFAULT_GEMINI_MODEL,
    inputGain: DEFAULT_INPUT_GAIN,
    dictationPreset: DEFAULT_DICTATION_PRESET,
    dictationMode: DEFAULT_DICTATION_MODE,
    translateEnabled: false,
    targetLanguage: "English",
    audioChimesEnabled: DEFAULT_AUDIO_CHIMES_ENABLED,
    chimeSoundStart: "glass",
    chimeSoundEnd: "submarine",
    symbolScannerEnabled: true,
    customVocabulary: [],
    presetVocabulary: {},
    appPresetMappings: DEFAULT_APP_PRESET_MAPPINGS,
  };
}

const configFileSchema = z.object({
  key: z
    .string()
    .refine(
      (v) => {
        try {
          parseKeyBinding(v);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid key binding" },
    )
    .optional()
    .default(DEFAULT_KEY_STRING),
  editKey: z
    .string()
    .refine(
      (v) => {
        try {
          parseKeyBinding(v);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid edit key binding" },
    )
    .optional()
    .default(DEFAULT_EDIT_KEY_STRING),
  provider: z.enum(["local", "gemini", "openai", "elevenlabs"]).optional().default(DEFAULT_PROVIDER),
  geminiModel: z.enum(["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-pro", "gemini-2.5-flash", "gemini-2.5-pro"]).optional().default(DEFAULT_GEMINI_MODEL),
  inputGain: z
    .number()
    .min(0.0)
    .max(2.0)
    .optional()
    .default(DEFAULT_INPUT_GAIN),
  dictationPreset: z.enum(["auto", "careful", "code_comment", "fast", "email_polish", "burmese_written", "translate"]).optional().default(DEFAULT_DICTATION_PRESET),
  dictationMode: z.enum(["toggle", "hold"]).optional().default(DEFAULT_DICTATION_MODE),
  translateEnabled: z.boolean().optional().default(false),
  targetLanguage: z.string().optional().default("English"),
  audioChimesEnabled: z.boolean().optional().default(DEFAULT_AUDIO_CHIMES_ENABLED),
  chimeSoundStart: z.enum(["glass", "submarine", "hero", "ping", "pop", "tink"]).optional().default("glass"),
  chimeSoundEnd: z.enum(["glass", "submarine", "hero", "ping", "pop", "tink"]).optional().default("submarine"),
  symbolScannerEnabled: z.boolean().optional().default(true),
  customVocabulary: z.array(z.string()).optional().default([]),
  presetVocabulary: z.record(z.string(), z.array(z.string())).optional().default({}),
  appPresetMappings: z.record(z.string(), z.string()).optional().default(DEFAULT_APP_PRESET_MAPPINGS),
  geminiApiKey: z.string().optional(),
  geminiFallbackApiKey: z.string().optional(),
  audioDeviceId: z.string().optional(),
});

export class ConfigError extends Error {
  constructor(
    public readonly configPath: string,
    public readonly details: string,
  ) {
    super(`Invalid config at ${configPath}:\n${details}`);
    this.name = "ConfigError";
  }
}

export function encryptSecret(secret?: string): string | undefined {
  if (!secret) return undefined;
  try {
    const electron = require("electron");
    if (electron?.safeStorage?.isEncryptionAvailable?.()) {
      return `enc:${electron.safeStorage.encryptString(secret).toString("base64")}`;
    }
  } catch {}
  return secret;
}

export function decryptSecret(encrypted?: string): string | undefined {
  if (!encrypted) return undefined;
  if (encrypted.startsWith("enc:")) {
    try {
      const electron = require("electron");
      if (electron?.safeStorage?.isEncryptionAvailable?.()) {
        const buffer = Buffer.from(encrypted.slice(4), "base64");
        return electron.safeStorage.decryptString(buffer);
      }
    } catch {}
    return undefined;
  }
  return encrypted;
}

export function resolveConfigPath(cwd: string = process.cwd()): string {
  const projPath = join(cwd, ".pi", "pi-voice.json");
  if (cwd && cwd !== "/" && cwd !== homedir() && existsSync(projPath)) {
    return projPath;
  }
  const userConfigPath = join(homedir(), ".config", "pi-voice", "config.json");
  if (existsSync(userConfigPath)) {
    return userConfigPath;
  }
  if (cwd && cwd !== "/" && cwd !== homedir()) {
    return projPath;
  }
  return userConfigPath;
}

export function loadConfig(cwd: string = process.cwd()): PiVoiceConfig {
  const defaults = defaultConfig();
  const configPath = resolveConfigPath(cwd);

  let rawContent: string;
  try {
    rawContent = readFileSync(configPath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      logger.info({ configPath }, "Config file not found, using defaults");
      return defaults;
    }
    throw new ConfigError(configPath, err.message);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (err: any) {
    throw new ConfigError(configPath, `JSON parse error: ${err.message}`);
  }

  const result = configFileSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigError(configPath, issues);
  }

  const { key: keyStr, editKey: editKeyStr, provider, geminiModel, inputGain, dictationPreset, dictationMode, translateEnabled, targetLanguage, audioChimesEnabled, chimeSoundStart, chimeSoundEnd, symbolScannerEnabled, customVocabulary, presetVocabulary, appPresetMappings, geminiApiKey, geminiFallbackApiKey, audioDeviceId } = result.data;
  const keyBinding = parseKeyBinding(keyStr);
  const editKeyBinding = parseKeyBinding(editKeyStr);

  const persistedVocab = loadPersistedVocabulary();
  const mergedCustomVocab = Array.from(new Set([...persistedVocab.customVocabulary, ...(customVocabulary || [])]));
  const mergedPresetVocab = {
    ...persistedVocab.presetVocabulary,
    ...(presetVocabulary || {}),
  };

  logger.info(
    { configPath, key: keyStr, editKey: editKeyStr, provider, geminiModel, inputGain, dictationPreset, dictationMode, translateEnabled, targetLanguage, audioChimesEnabled, symbolScannerEnabled, vocabularyCount: mergedCustomVocab.length },
    "Loaded config",
  );

  return {
    key: keyBinding,
    keyDisplay: formatKeyDisplay(keyBinding),
    editKey: editKeyBinding,
    editKeyDisplay: formatKeyDisplay(editKeyBinding),
    provider,
    geminiModel: geminiModel as GeminiModelChoice,
    inputGain,
    dictationPreset,
    dictationMode,
    translateEnabled,
    targetLanguage,
    audioChimesEnabled,
    chimeSoundStart,
    chimeSoundEnd,
    symbolScannerEnabled,
    customVocabulary: mergedCustomVocab,
    presetVocabulary: mergedPresetVocab,
    appPresetMappings: (appPresetMappings || DEFAULT_APP_PRESET_MAPPINGS) as Record<string, DictationPreset>,
    geminiApiKey: decryptSecret(geminiApiKey),
    geminiFallbackApiKey: decryptSecret(geminiFallbackApiKey),
    audioDeviceId,
  };
}

export function updateConfig(cwd: string = process.cwd(), patch: PiVoiceConfigPatch): PiVoiceConfig {
  const configPath = resolveConfigPath(cwd);
  const targetDir = dirname(configPath);
  const tmpPath = `${configPath}.tmp`;

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  let existingJson: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      existingJson = JSON.parse(content);
    } catch {}
  }

  // Encrypt secrets if provided in patch
  if (patch.geminiApiKey !== undefined) {
    patch.geminiApiKey = encryptSecret(patch.geminiApiKey);
  }
  if (patch.geminiFallbackApiKey !== undefined) {
    patch.geminiFallbackApiKey = encryptSecret(patch.geminiFallbackApiKey);
  }

  // Sanitize custom terms
  const sanitizedVocabulary = patch.customVocabulary !== undefined
    ? patch.customVocabulary
        .map((term) => term.trim().slice(0, 40))
        .filter((term) => term.length > 0)
        .slice(0, 50)
    : undefined;

  const persistedVocab = loadPersistedVocabulary();
  const existingPresetVocab = (existingJson.presetVocabulary as Record<string, string[]>) || {};
  const mergedPresetVocab = patch.presetVocabulary !== undefined
    ? { ...persistedVocab.presetVocabulary, ...existingPresetVocab, ...patch.presetVocabulary }
    : { ...persistedVocab.presetVocabulary, ...existingPresetVocab };

  const finalCustomVocab = sanitizedVocabulary !== undefined ? sanitizedVocabulary : Array.from(new Set([...persistedVocab.customVocabulary, ...((existingJson.customVocabulary as string[]) || [])]));

  savePersistedVocabulary({
    customVocabulary: finalCustomVocab,
    presetVocabulary: mergedPresetVocab,
  });

  const existingAppMappings = (existingJson.appPresetMappings as Record<string, DictationPreset>) || DEFAULT_APP_PRESET_MAPPINGS;
  const mergedAppMappings = patch.appPresetMappings !== undefined
    ? patch.appPresetMappings
    : existingAppMappings;

  // Preserve unrelated keys while merging patch
  const mergedJson = {
    ...existingJson,
    ...(patch.key !== undefined ? { key: patch.key } : {}),
    ...(patch.editKey !== undefined ? { editKey: patch.editKey } : {}),
    ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
    ...(patch.geminiModel !== undefined ? { geminiModel: patch.geminiModel } : {}),
    ...(patch.inputGain !== undefined ? { inputGain: Math.max(0.0, Math.min(2.0, patch.inputGain)) } : {}),
    ...(patch.dictationPreset !== undefined ? { dictationPreset: patch.dictationPreset } : {}),
    ...(patch.dictationMode !== undefined ? { dictationMode: patch.dictationMode } : {}),
    ...(patch.translateEnabled !== undefined ? { translateEnabled: patch.translateEnabled } : {}),
    ...(patch.targetLanguage !== undefined ? { targetLanguage: patch.targetLanguage } : {}),
    ...(patch.audioChimesEnabled !== undefined ? { audioChimesEnabled: patch.audioChimesEnabled } : {}),
    ...(patch.chimeSoundStart !== undefined ? { chimeSoundStart: patch.chimeSoundStart } : {}),
    ...(patch.chimeSoundEnd !== undefined ? { chimeSoundEnd: patch.chimeSoundEnd } : {}),
    ...(patch.symbolScannerEnabled !== undefined ? { symbolScannerEnabled: patch.symbolScannerEnabled } : {}),
    customVocabulary: finalCustomVocab,
    presetVocabulary: mergedPresetVocab,
    appPresetMappings: mergedAppMappings,
    ...(patch.geminiApiKey !== undefined ? { geminiApiKey: patch.geminiApiKey.trim() } : {}),
    ...(patch.geminiFallbackApiKey !== undefined ? { geminiFallbackApiKey: patch.geminiFallbackApiKey.trim() } : {}),
    ...(patch.audioDeviceId !== undefined ? { audioDeviceId: patch.audioDeviceId.trim() } : {}),
  };

  const validationResult = configFileSchema.safeParse(mergedJson);
  if (!validationResult.success) {
    const issues = validationResult.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigError(configPath, issues);
  }

  // Atomic write via temporary file + atomic rename
  try {
    writeFileSync(tmpPath, JSON.stringify(mergedJson, null, 2), "utf-8");
    renameSync(tmpPath, configPath);
  } catch (err: any) {
    logger.error({ err: String(err), configPath }, "Failed atomic write of config patch");
    throw new ConfigError(configPath, `Atomic write failed: ${err.message}`);
  }

  return loadConfig(cwd);
}
