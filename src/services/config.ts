import { join, dirname } from "node:path";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { UiohookKey } from "uiohook-napi";
import { z } from "zod";
import logger from "./logger.js";
import { loadPersistedVocabulary, savePersistedVocabulary, migrateVocabulary, backfillLegacyWhitespace } from "./vocabulary-service.js";
import { validateDictionaryEntries } from "./dictionary-engine.js";
import type { ChimeSoundChoice, DictionaryEntry, GeminiModelChoice, KeyBinding, SpeechProvider, DictationPreset, DictationMode } from "../shared/types.js";
export type { KeyBinding, SpeechProvider, DictationPreset, DictationMode };

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
  transcriptionDelaySec: number;
  autoEndpointEnabled: boolean;
  customVocabulary: string[];
  presetVocabulary: Partial<Record<DictationPreset, string[]>>;
  dictionaryEntries: DictionaryEntry[];
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
  transcriptionDelaySec?: number;
  autoEndpointEnabled?: boolean;
  customVocabulary?: string[];
  presetVocabulary?: Partial<Record<DictationPreset, string[]>>;
  dictionaryEntries?: DictionaryEntry[];
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

export function formatKeyBinding(binding: KeyBinding): string {
  const keyName = Object.entries(KEY_MAP).find(([, v]) => v === binding.keycode)?.[0];
  if (!keyName) throw new Error(`Unknown keycode "${binding.keycode}"`);
  return [
    binding.ctrl && "ctrl",
    binding.alt && "alt",
    binding.shift && "shift",
    binding.meta && "cmd",
    keyName,
  ].filter(Boolean).join("+");
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
const DEFAULT_TRANSCRIPTION_DELAY_SEC = 0.5;
const DEFAULT_AUTO_ENDPOINT_ENABLED = true;

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

export function defaultConfig(): PiVoiceConfig {
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
    transcriptionDelaySec: DEFAULT_TRANSCRIPTION_DELAY_SEC,
    autoEndpointEnabled: DEFAULT_AUTO_ENDPOINT_ENABLED,
    customVocabulary: [],
    presetVocabulary: {},
    dictionaryEntries: migrateVocabulary([], {}),
    appPresetMappings: DEFAULT_APP_PRESET_MAPPINGS,
  };
}

export const configFileSchema = z.object({
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
  transcriptionDelaySec: z.number().min(0.0).max(10.0).optional().default(DEFAULT_TRANSCRIPTION_DELAY_SEC),
  autoEndpointEnabled: z.boolean().optional().default(DEFAULT_AUTO_ENDPOINT_ENABLED),
  customVocabulary: z.array(z.string()).optional().default([]),
  presetVocabulary: z.record(z.string(), z.array(z.string())).optional().default({}),
  dictionaryEntries: z.array(z.object({ id: z.string(), phrase: z.string(), spokenAliases: z.array(z.string()), enabled: z.boolean(), legacyWhitespace: z.boolean().optional(), category: z.enum(["general", "person_name", "technical"]).optional() })).optional().default([]),
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

function getUserHome(): string {
  return process.env.HOME || homedir();
}

export function getUserConfigPath(): string {
  const baseDir = process.env.XDG_CONFIG_HOME || join(getUserHome(), ".config");
  return join(baseDir, "pi-voice", "config.json");
}

function getLegacyUserConfigPath(): string {
  return join(getUserHome(), ".config", "pi-voice", "config.json");
}

export function getProjConfigPath(cwd: string = process.cwd()): string | null {
  if (!cwd || cwd === "/" || cwd === getUserHome()) {
    return null;
  }
  return join(cwd, ".pi", "pi-voice.json");
}

export function resolveConfigPath(cwd: string = process.cwd()): string {
  const projPath = getProjConfigPath(cwd);
  if (projPath && existsSync(projPath)) {
    return projPath;
  }
  return getUserConfigPath();
}

const LEGACY_MODEL_MAP: Record<string, GeminiModelChoice> = {
  "gemini-1.5-flash": "gemini-3.1-flash-lite",
  "gemini-1.5-pro": "gemini-3.1-pro",
  "gemini-1.0-pro": "gemini-3.1-flash-lite",
  "gemini-2.0-flash": "gemini-2.5-flash",
};

function backupCorruptConfig(filePath: string): void {
  const basePath = join(dirname(filePath), "config.json.corrupt");
  let backupPath = `${basePath}.bak`;
  let suffix = 0;
  while (existsSync(backupPath)) {
    suffix += 1;
    backupPath = `${basePath}.${Date.now()}${suffix}.bak`;
  }
  renameSync(filePath, backupPath);
}

function repairConfigJson(raw: Record<string, unknown>): { json: Record<string, unknown>; changed: boolean } {
  const json = { ...raw };
  let changed = false;

  if (typeof json.geminiModel === "string") {
    const rawModel = json.geminiModel;
    if (LEGACY_MODEL_MAP[rawModel]) {
      json.geminiModel = LEGACY_MODEL_MAP[rawModel];
      changed = true;
    } else if (rawModel.startsWith("gemini-1.")) {
      json.geminiModel = "gemini-3.1-flash-lite";
      changed = true;
    } else if (rawModel.startsWith("gemini-2.0")) {
      json.geminiModel = "gemini-2.5-flash";
      changed = true;
    }
  }

  if (json.dictationPreset === "translate") {
    json.dictationPreset = "careful";
    if (json.translateEnabled === undefined) json.translateEnabled = true;
    changed = true;
  }

  let result = configFileSchema.safeParse(json);
  while (!result.success) {
    const fields = new Set(result.error.issues.map((issue) => issue.path[0]).filter((field): field is string => typeof field === "string"));
    if (fields.size === 0) break;
    for (const field of fields) {
      delete json[field];
      changed = true;
    }
    result = configFileSchema.safeParse(json);
  }

  return { json, changed };
}

function readConfigJson(filePath: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Config must be a JSON object");
  }
  return parsed;
}

export function loadConfig(cwd: string = process.cwd()): PiVoiceConfig {
  const defaults = defaultConfig();
  const canonicalUserConfigPath = getUserConfigPath();
  const legacyUserConfigPath = getLegacyUserConfigPath();
  let userConfigPath = existsSync(canonicalUserConfigPath) || canonicalUserConfigPath === legacyUserConfigPath
    ? canonicalUserConfigPath
    : legacyUserConfigPath;
  const projConfigPath = getProjConfigPath(cwd);

  let globalJson: Record<string, unknown> = {};
  let globalExists = false;
  if (existsSync(userConfigPath)) {
    try {
      globalJson = readConfigJson(userConfigPath);
      globalExists = true;
    } catch (err: any) {
      if (err instanceof ConfigError) throw err;
      logger.warn(
        { userConfigPath, err: err?.message },
        "Corrupt user config file, backing up to config.json.corrupt.bak and auto-recovering to defaults",
      );
      try {
        backupCorruptConfig(userConfigPath);
      } catch (backupErr: any) {
        logger.warn({ backupErr: backupErr?.message }, "Failed to rename corrupt user config file");
      }
      if (userConfigPath === canonicalUserConfigPath && canonicalUserConfigPath !== legacyUserConfigPath && existsSync(legacyUserConfigPath)) {
        try {
          globalJson = readConfigJson(legacyUserConfigPath);
          globalExists = true;
          userConfigPath = legacyUserConfigPath;
        } catch {
          try {
            backupCorruptConfig(legacyUserConfigPath);
          } catch (backupErr: any) {
            logger.warn({ backupErr: backupErr?.message }, "Failed to rename corrupt legacy user config file");
          }
        }
      }
    }
  }

  let projJson: Record<string, unknown> = {};
  let projExists = false;
  if (projConfigPath && existsSync(projConfigPath)) {
    try {
      projJson = readConfigJson(projConfigPath);
      projExists = true;
    } catch (err: any) {
      if (err instanceof ConfigError) throw err;
      logger.warn(
        { projConfigPath, err: err?.message },
        "Corrupt project config file, backing up to config.json.corrupt.bak and auto-recovering to defaults",
      );
      try {
        backupCorruptConfig(projConfigPath);
      } catch (backupErr: any) {
        logger.warn({ backupErr: backupErr?.message }, "Failed to rename corrupt project config file");
      }
    }
  }

  if (!globalExists && !projExists) {
    logger.info({ userConfigPath }, "Config file not found, using defaults");
    return defaults;
  }

  const primaryPath = projExists ? projConfigPath! : userConfigPath;
  const repairedGlobal = repairConfigJson(globalJson);
  const repairedProject = repairConfigJson(projJson);
  globalJson = repairedGlobal.json;
  projJson = repairedProject.json;
  try {
    if (repairedGlobal.changed) atomicWriteJson(userConfigPath, globalJson);
    if (repairedProject.changed && projConfigPath) atomicWriteJson(projConfigPath, projJson);
  } catch (saveErr: any) {
    logger.warn({ err: saveErr?.message }, "Failed to auto-heal config to disk");
  }

  const mergedRaw: Record<string, unknown> = { ...globalJson, ...projJson };
  let result = configFileSchema.safeParse(mergedRaw);
  const config = result.success ? result.data : configFileSchema.parse({});

  const {
    key: keyStr,
    editKey: editKeyStr,
    provider,
    geminiModel,
    inputGain,
    dictationPreset: rawDictationPreset,
    dictationMode,
    translateEnabled: rawTranslateEnabled,
    targetLanguage,
    audioChimesEnabled,
    chimeSoundStart,
    chimeSoundEnd,
    symbolScannerEnabled,
    transcriptionDelaySec,
    autoEndpointEnabled,
    customVocabulary,
    presetVocabulary,
    dictionaryEntries,
    appPresetMappings,
    geminiApiKey,
    geminiFallbackApiKey,
    audioDeviceId,
  } = config;

  let keyBinding: KeyBinding;
  try {
    keyBinding = parseKeyBinding(keyStr);
  } catch {
    logger.warn({ keyStr }, "Failed to parse key binding, falling back to default key binding");
    keyBinding = parseKeyBinding(DEFAULT_KEY_STRING);
  }

  let editKeyBinding: KeyBinding;
  try {
    editKeyBinding = parseKeyBinding(editKeyStr);
  } catch {
    logger.warn({ editKeyStr }, "Failed to parse edit key binding, falling back to default edit key binding");
    editKeyBinding = parseKeyBinding(DEFAULT_EDIT_KEY_STRING);
  }

  let dictationPreset = rawDictationPreset;
  let translateEnabled = rawTranslateEnabled;
  if ((mergedRaw as any)?.dictationPreset === "translate" || rawDictationPreset === "translate") {
    dictationPreset = "careful";
    if ((mergedRaw as any)?.translateEnabled === undefined) {
      translateEnabled = true;
    }
  }

  const persistedVocab = loadPersistedVocabulary();
  const mergedCustomVocab = Array.from(new Set([...persistedVocab.customVocabulary, ...(customVocabulary || [])]));
  const mergedPresetVocab = {
    ...persistedVocab.presetVocabulary,
    ...(presetVocabulary || {}),
  };
  let mergedDictionaryEntries = dictionaryEntries.length > 0
    ? backfillLegacyWhitespace(dictionaryEntries)
    : migrateVocabulary(mergedCustomVocab, mergedPresetVocab, persistedVocab.entries || []);
  const dictionaryErrors = validateDictionaryEntries(mergedDictionaryEntries);
  if (dictionaryErrors.length > 0) {
    logger.warn({ errors: dictionaryErrors }, "Invalid dictionary entries found, resetting dictionary entries to empty");
    mergedDictionaryEntries = [];
  }

  logger.info(
    { configPath: primaryPath, key: keyStr, editKey: editKeyStr, provider, geminiModel, inputGain, dictationPreset, dictationMode, translateEnabled, targetLanguage, audioChimesEnabled, symbolScannerEnabled, vocabularyCount: mergedCustomVocab.length },
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
    transcriptionDelaySec,
    autoEndpointEnabled,
    customVocabulary: mergedCustomVocab,
    presetVocabulary: mergedPresetVocab,
    dictionaryEntries: mergedDictionaryEntries,
    appPresetMappings: (appPresetMappings || DEFAULT_APP_PRESET_MAPPINGS) as Record<string, DictationPreset>,
    geminiApiKey: decryptSecret(geminiApiKey),
    geminiFallbackApiKey: decryptSecret(geminiFallbackApiKey),
    audioDeviceId,
  };
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const targetDir = dirname(filePath);
  const tmpPath = `${filePath}.tmp`;
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

function preparePatchSave(existingJson: Record<string, unknown>, patch: PiVoiceConfigPatch, targetPath: string): Record<string, unknown> {
  let baseJson = { ...existingJson };
  if (baseJson.dictationPreset === "translate" && baseJson.translateEnabled === undefined) {
    baseJson = { ...baseJson, dictationPreset: "careful", translateEnabled: true };
  }

  const patchCopy = { ...patch };

  if (patchCopy.geminiApiKey !== undefined) {
    const trimmed = patchCopy.geminiApiKey.trim();
    patchCopy.geminiApiKey = trimmed ? encryptSecret(trimmed) : "";
  }
  if (patchCopy.geminiFallbackApiKey !== undefined) {
    const trimmed = patchCopy.geminiFallbackApiKey.trim();
    patchCopy.geminiFallbackApiKey = trimmed ? encryptSecret(trimmed) : "";
  }

  const persistedVocab = loadPersistedVocabulary();
  const existingPresetVocab = (baseJson.presetVocabulary as Record<string, string[]>) || {};
  const mergedPresetVocab = patchCopy.presetVocabulary !== undefined
    ? { ...persistedVocab.presetVocabulary, ...existingPresetVocab, ...patchCopy.presetVocabulary }
    : { ...persistedVocab.presetVocabulary, ...existingPresetVocab };

  const finalCustomVocab = patchCopy.customVocabulary !== undefined
    ? patchCopy.customVocabulary.map((term) => term.trim()).filter(Boolean)
    : Array.from(new Set([...persistedVocab.customVocabulary, ...((baseJson.customVocabulary as string[]) || [])]));
  const finalDictionaryEntries = patchCopy.dictionaryEntries !== undefined
    ? patchCopy.dictionaryEntries
    : (persistedVocab.entries || migrateVocabulary(finalCustomVocab, mergedPresetVocab));
  const dictionaryErrors = validateDictionaryEntries(finalDictionaryEntries);
  if (dictionaryErrors.length > 0) {
    throw new ConfigError(targetPath, dictionaryErrors.map((error) => `${error.alias}: ${error.message}`).join("\n"));
  }

  savePersistedVocabulary({
    customVocabulary: finalCustomVocab,
    presetVocabulary: mergedPresetVocab,
    entries: finalDictionaryEntries,
  });

  const existingAppMappings = (baseJson.appPresetMappings as Record<string, DictationPreset>) || DEFAULT_APP_PRESET_MAPPINGS;
  const mergedAppMappings = patchCopy.appPresetMappings !== undefined
    ? patchCopy.appPresetMappings
    : existingAppMappings;

  if (patchCopy.dictationPreset === "translate") {
    patchCopy.dictationPreset = "careful";
    if (patchCopy.translateEnabled === undefined) {
      patchCopy.translateEnabled = true;
    }
  }

  const mergedJson = {
    ...baseJson,
    ...(patchCopy.key !== undefined ? { key: patchCopy.key } : {}),
    ...(patchCopy.editKey !== undefined ? { editKey: patchCopy.editKey } : {}),
    ...(patchCopy.provider !== undefined ? { provider: patchCopy.provider } : {}),
    ...(patchCopy.geminiModel !== undefined ? { geminiModel: patchCopy.geminiModel } : {}),
    ...(patchCopy.inputGain !== undefined ? { inputGain: Math.max(0.0, Math.min(2.0, patchCopy.inputGain)) } : {}),
    ...(patchCopy.dictationPreset !== undefined ? { dictationPreset: patchCopy.dictationPreset } : {}),
    ...(patchCopy.dictationMode !== undefined ? { dictationMode: patchCopy.dictationMode } : {}),
    ...(patchCopy.translateEnabled !== undefined ? { translateEnabled: patchCopy.translateEnabled } : {}),
    ...(patchCopy.targetLanguage !== undefined ? { targetLanguage: patchCopy.targetLanguage } : {}),
    ...(patchCopy.audioChimesEnabled !== undefined ? { audioChimesEnabled: patchCopy.audioChimesEnabled } : {}),
    ...(patchCopy.chimeSoundStart !== undefined ? { chimeSoundStart: patchCopy.chimeSoundStart } : {}),
    ...(patchCopy.chimeSoundEnd !== undefined ? { chimeSoundEnd: patchCopy.chimeSoundEnd } : {}),
    ...(patchCopy.symbolScannerEnabled !== undefined ? { symbolScannerEnabled: patchCopy.symbolScannerEnabled } : {}),
    ...(patchCopy.transcriptionDelaySec !== undefined ? { transcriptionDelaySec: Math.max(0.0, Math.min(10.0, patchCopy.transcriptionDelaySec)) } : {}),
    ...(patchCopy.autoEndpointEnabled !== undefined ? { autoEndpointEnabled: patchCopy.autoEndpointEnabled } : {}),
    customVocabulary: finalCustomVocab,
    presetVocabulary: mergedPresetVocab,
    dictionaryEntries: finalDictionaryEntries,
    appPresetMappings: mergedAppMappings,
    ...(patchCopy.geminiApiKey !== undefined ? { geminiApiKey: patchCopy.geminiApiKey } : {}),
    ...(patchCopy.geminiFallbackApiKey !== undefined ? { geminiFallbackApiKey: patchCopy.geminiFallbackApiKey } : {}),
    ...(patchCopy.audioDeviceId !== undefined ? { audioDeviceId: patchCopy.audioDeviceId.trim() } : {}),
  };

  const validationResult = configFileSchema.safeParse(mergedJson);
  if (!validationResult.success) {
    const issues = validationResult.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigError(targetPath, issues);
  }

  return {
    ...mergedJson,
    translateEnabled: validationResult.data.translateEnabled,
    targetLanguage: validationResult.data.targetLanguage,
    dictationPreset: validationResult.data.dictationPreset,
  };
}

export function updateConfig(cwd: string = process.cwd(), patch: PiVoiceConfigPatch): PiVoiceConfig {
  const userConfigPath = getUserConfigPath();
  const legacyUserConfigPath = getLegacyUserConfigPath();
  const projConfigPath = getProjConfigPath(cwd);
  const hasProjConfig = projConfigPath ? existsSync(projConfigPath) : false;

  let existingUserJson: Record<string, unknown> = {};
  try {
    existingUserJson = readConfigJson(userConfigPath);
  } catch {
    if (userConfigPath !== legacyUserConfigPath && existsSync(legacyUserConfigPath)) {
      try {
        existingUserJson = readConfigJson(legacyUserConfigPath);
      } catch {}
    }
  }
  const toSaveUser = preparePatchSave(existingUserJson, patch, userConfigPath);
  let toSaveProj: Record<string, unknown> | undefined;
  let existingProjJson: Record<string, unknown> | undefined;
  if (hasProjConfig && projConfigPath) {
    existingProjJson = {};
    try {
      const content = readFileSync(projConfigPath, "utf-8");
      existingProjJson = JSON.parse(content);
    } catch {}
    toSaveProj = preparePatchSave(existingProjJson!, patch, projConfigPath);
  }

  if (toSaveProj && projConfigPath && existingProjJson) {
    try {
      atomicWriteJson(projConfigPath, toSaveProj);
    } catch (err: any) {
      logger.error({ err: String(err), configPath: projConfigPath }, "Failed atomic write of project config patch");
      throw new ConfigError(projConfigPath, `Atomic write failed: ${err.message}`);
    }
  }

  try {
    atomicWriteJson(userConfigPath, toSaveUser);
  } catch (err: any) {
    if (toSaveProj && projConfigPath && existingProjJson) {
      try {
        atomicWriteJson(projConfigPath, existingProjJson);
      } catch (rollbackErr: any) {
        logger.error({ err: String(rollbackErr), configPath: projConfigPath }, "Failed to roll back project config patch");
      }
    }
    logger.error({ err: String(err), configPath: userConfigPath }, "Failed atomic write of global user config patch");
    throw new ConfigError(userConfigPath, `Atomic write failed: ${err.message}`);
  }

  return loadConfig(cwd);
}
