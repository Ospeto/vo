import { join, dirname, basename } from "node:path";
import fs, { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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
  geminiKeyError?: string;
  geminiFallbackKeyError?: string;
  legacyProjectKeyBlocked?: boolean;
  legacyProjectKeyRemediation?: string;
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
  appPresetMappings: z.record(z.string(), z.enum(["auto", "careful", "code_comment", "fast", "email_polish", "burmese_written", "translate"])).optional().default(DEFAULT_APP_PRESET_MAPPINGS),
  geminiApiKey: z.string().optional(),
  geminiFallbackApiKey: z.string().optional(),
  audioDeviceId: z.string().optional(),
});

export const configPatchSchema = z
  .object({
    key: z
      .string()
      .max(100)
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
      .optional(),
    editKey: z
      .string()
      .max(100)
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
      .optional(),
    provider: z.enum(["local", "gemini", "openai", "elevenlabs"]).optional(),
    geminiModel: z.enum(["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-pro", "gemini-2.5-flash", "gemini-2.5-pro"]).optional(),
    inputGain: z.number().min(0.0).max(2.0).optional(),
    dictationPreset: z.enum(["auto", "careful", "code_comment", "fast", "email_polish", "burmese_written", "translate"]).optional(),
    dictationMode: z.enum(["toggle", "hold"]).optional(),
    translateEnabled: z.boolean().optional(),
    targetLanguage: z.string().max(200).optional(),
    audioChimesEnabled: z.boolean().optional(),
    chimeSoundStart: z.enum(["glass", "submarine", "hero", "ping", "pop", "tink"]).optional(),
    chimeSoundEnd: z.enum(["glass", "submarine", "hero", "ping", "pop", "tink"]).optional(),
    symbolScannerEnabled: z.boolean().optional(),
    transcriptionDelaySec: z.number().min(0.0).max(10.0).optional(),
    autoEndpointEnabled: z.boolean().optional(),
    customVocabulary: z.array(z.string().max(200)).max(1000).optional(),
    presetVocabulary: z.record(z.string(), z.array(z.string().max(200)).max(1000)).optional(),
    dictionaryEntries: z
      .array(
        z
          .object({
            id: z.string().max(100),
            phrase: z.string().max(500),
            spokenAliases: z.array(z.string().max(200)).max(50),
            enabled: z.boolean(),
            legacyWhitespace: z.boolean().optional(),
            category: z.enum(["general", "person_name", "technical"]).optional(),
          })
          .strict(),
      )
      .max(1000)
      .optional(),
    appPresetMappings: z
      .record(z.string().max(100), z.enum(["auto", "careful", "code_comment", "fast", "email_polish", "burmese_written", "translate"]))
      .optional(),
    geminiApiKey: z.string().max(1000).optional(),
    geminiFallbackApiKey: z.string().max(1000).optional(),
    audioDeviceId: z.string().max(200).optional(),
  })
  .strict();

export class ConfigError extends Error {
  constructor(
    public readonly configPath: string,
    public readonly details: string,
  ) {
    super(`Invalid config at ${configPath}:\n${details}`);
    this.name = "ConfigError";
  }
}

export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretStoreError";
  }
}

export interface SafeStorageProvider {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (cipherText: Buffer) => string;
  getSelectedStorageBackend?: () => string;
}

let safeStorageOverride: SafeStorageProvider | null = null;

export function setSafeStorageProvider(provider: SafeStorageProvider | null): void {
  safeStorageOverride = provider;
}

function getSafeStorage(): SafeStorageProvider | null {
  if (safeStorageOverride !== null) {
    return safeStorageOverride;
  }
  try {
    const electron = require("electron");
    if (electron?.safeStorage) {
      return electron.safeStorage;
    }
  } catch {}
  return null;
}

export function isStrongEncryptionAvailable(): boolean {
  try {
    const ss = getSafeStorage();
    if (!ss || typeof ss.isEncryptionAvailable !== "function") return false;
    if (!ss.isEncryptionAvailable()) return false;
    if (process.platform === "linux" && typeof ss.getSelectedStorageBackend === "function") {
      const backend = ss.getSelectedStorageBackend();
      if (backend === "basic_text") return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(secret: string): string {
  if (!secret) return secret;
  if (!isStrongEncryptionAvailable()) {
    throw new SecretStoreError("Strong encryption is unavailable (safeStorage missing or Linux basic_text)");
  }
  const ss = getSafeStorage()!;
  try {
    const buf = ss.encryptString(secret);
    return `enc:${buf.toString("base64")}`;
  } catch (err: any) {
    throw new SecretStoreError(`Encryption failed: ${err?.message || err}`);
  }
}

export type SecretState =
  | { status: "absent" }
  | { status: "available"; value: string; ciphertext: string; needsMigration?: boolean }
  | { status: "decrypt-error"; error: string; rawCiphertext: string };

export function resolveSecretState(raw?: unknown): SecretState {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { status: "absent" };
  }
  const str = raw.trim();
  if (str.startsWith("enc:")) {
    if (!isStrongEncryptionAvailable()) {
      return { status: "decrypt-error", error: "Strong encryption is unavailable", rawCiphertext: str };
    }
    const ss = getSafeStorage();
    try {
      const buf = Buffer.from(str.slice(4), "base64");
      const decrypted = ss!.decryptString(buf);
      return { status: "available", value: decrypted, ciphertext: str };
    } catch (err: any) {
      return { status: "decrypt-error", error: "Failed to decrypt API key", rawCiphertext: str };
    }
  } else {
    // Legacy plaintext
    if (!isStrongEncryptionAvailable()) {
      return { status: "decrypt-error", error: "Strong encryption is unavailable for legacy plaintext key", rawCiphertext: str };
    }
    return { status: "available", value: str, ciphertext: str, needsMigration: true };
  }
}

export function decryptSecret(encrypted?: string): string | undefined {
  const state = resolveSecretState(encrypted);
  return state.status === "available" ? state.value : undefined;
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

const CONFIG_LOCK_TIMEOUT_MS = 10_000;
const CONFIG_LOCK_RETRY_MS = 10;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withFileLock<T>(lockPath: string, action: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(lockPath, "a", 0o600);
  fs.closeSync(fd);
  chmodSync(lockPath, 0o600);

  const readyPath = `${lockPath}.${process.pid}.${randomUUID()}.ready`;
  const locker = existsSync("/usr/bin/lockf")
    ? spawn("/usr/bin/lockf", ["-k", "-t", "10", lockPath, "/bin/sh", "-c", ': > "$1"; cat', "sh", readyPath], { stdio: ["pipe", "ignore", "ignore"] })
    : spawn("/usr/bin/flock", ["-x", "-w", "10", lockPath, "/bin/sh", "-c", ': > "$1"; cat', "sh", readyPath], { stdio: ["pipe", "ignore", "ignore"] });
  locker.on("error", () => {});
  const started = Date.now();
  while (!existsSync(readyPath)) {
    if (Date.now() - started >= CONFIG_LOCK_TIMEOUT_MS) {
      locker.kill();
      try { unlinkSync(readyPath); } catch {}
      throw new ConfigError(lockPath, "Timed out waiting for another config operation");
    }
    sleepSync(CONFIG_LOCK_RETRY_MS);
  }

  try {
    return action();
  } finally {
    try { unlinkSync(readyPath); } catch {}
    locker.stdin?.end();
    locker.kill();
  }
}

function withConfigLock<T>(action: () => T): T {
  return withFileLock(`${getUserConfigPath()}.lock`, action);
}

function backupCorruptConfig(filePath: string, rawBytes: Buffer, mode: number): string {
  const backupPath = join(
    dirname(filePath),
    `${basename(filePath)}.corrupt.${Date.now()}.${process.pid}.${randomUUID()}.bak`,
  );
  let fd: number | undefined;
  try {
    fd = fs.openSync(backupPath, "wx", mode);
    fs.writeFileSync(fd, rawBytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    chmodSync(backupPath, mode);
    unlinkSync(filePath);
    return backupPath;
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { unlinkSync(backupPath); } catch {}
    throw err;
  }
}

function removeInvalidValue(json: Record<string, unknown>, path: PropertyKey[]): boolean {
  if (path.length === 0 || typeof path[0] !== "string") return false;
  if (path[0] === "dictionaryEntries" && typeof path[1] === "number" && Array.isArray(json.dictionaryEntries)) {
    if (path[1] < 0 || path[1] >= json.dictionaryEntries.length) return false;
    json.dictionaryEntries.splice(path[1], 1);
    return true;
  }

  let parent: any = json;
  for (const segment of path.slice(0, -1)) {
    if (parent === null || typeof parent !== "object" || !(segment in parent)) return false;
    parent = parent[segment as any];
  }
  const leaf = path[path.length - 1]!;
  if (Array.isArray(parent) && typeof leaf === "number" && leaf >= 0 && leaf < parent.length) {
    parent.splice(leaf, 1);
    return true;
  }
  if (parent !== null && typeof parent === "object" && leaf in parent) {
    delete parent[leaf as any];
    return true;
  }
  return false;
}

function repairConfigJson(raw: Record<string, unknown>): { json: Record<string, unknown>; changed: boolean } {
  const json = structuredClone(raw);
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
    const issue = result.error.issues[0];
    if (!issue || !removeInvalidValue(json, issue.path)) {
      throw new ConfigError("config.json", issue?.message || "Config cannot be repaired safely");
    }
    changed = true;
    result = configFileSchema.safeParse(json);
  }

  return { json, changed };
}

export interface ReadConfigResult {
  filePath: string;
  exists: boolean;
  json: Record<string, unknown>;
  corrupt: boolean;
  backupPath?: string;
  backupError?: Error;
  repaired: boolean;
  rawBytes?: Buffer;
  mode?: number;
}

function inspectConfig(filePath: string): ReadConfigResult {
  if (!existsSync(filePath)) {
    return { filePath, exists: false, json: {}, corrupt: false, repaired: false };
  }

  let rawBytes: Buffer;
  let mode = 0o600;
  try {
    rawBytes = readFileSync(filePath);
    mode = fs.statSync(filePath).mode & 0o777;
  } catch (err: any) {
    return {
      filePath,
      exists: true,
      json: {},
      corrupt: true,
      backupError: err instanceof Error ? err : new Error(String(err)),
      repaired: false,
    };
  }

  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SyntaxError("Config must be a JSON object");
    }
    const { json, changed } = repairConfigJson(parsed);
    return { filePath, exists: true, json, corrupt: false, repaired: changed, rawBytes, mode };
  } catch (err: any) {
    if (err instanceof ConfigError) throw err;
    return { filePath, exists: true, json: {}, corrupt: true, repaired: false, rawBytes, mode };
  }
}

function recoverConfig(result: ReadConfigResult, userScope: boolean): ReadConfigResult {
  if (!result.corrupt || result.backupError || !result.rawBytes) return result;
  try {
    result.backupPath = backupCorruptConfig(result.filePath, result.rawBytes, userScope ? 0o600 : (result.mode ?? 0o600));
  } catch (err: any) {
    result.backupError = err instanceof Error ? err : new Error(String(err));
  }
  return result;
}

export function readAndRepairConfig(filePath: string): ReadConfigResult {
  const userScope = filePath === getUserConfigPath() || filePath === getLegacyUserConfigPath();
  return withConfigLock(() => recoverConfig(inspectConfig(filePath), userScope));
}

function loadConfigUnlocked(cwd: string = process.cwd()): PiVoiceConfig {
  const defaults = defaultConfig();
  const canonicalUserConfigPath = getUserConfigPath();
  const legacyUserConfigPath = getLegacyUserConfigPath();
  let userConfigPath = existsSync(canonicalUserConfigPath) || canonicalUserConfigPath === legacyUserConfigPath
    ? canonicalUserConfigPath
    : legacyUserConfigPath;
  const projConfigPath = getProjConfigPath(cwd);

  let globalJson: Record<string, unknown> = {};
  let globalExists = false;

  const globalResult = recoverConfig(inspectConfig(userConfigPath), true);
  if (globalResult.exists && !globalResult.corrupt) {
    globalJson = globalResult.json;
    globalExists = true;
  } else if (globalResult.corrupt) {
    if (globalResult.backupError) {
      logger.warn({ userConfigPath, err: globalResult.backupError.message }, "Failed to rename corrupt user config file");
    } else {
      logger.warn(
        { userConfigPath, backupPath: globalResult.backupPath },
        "Corrupt user config file, backed up to config.json.corrupt.bak and auto-recovering to defaults",
      );
    }
    if (userConfigPath === canonicalUserConfigPath && canonicalUserConfigPath !== legacyUserConfigPath && existsSync(legacyUserConfigPath)) {
      const legacyResult = recoverConfig(inspectConfig(legacyUserConfigPath), true);
      if (legacyResult.exists && !legacyResult.corrupt) {
        globalJson = legacyResult.json;
        globalExists = true;
        userConfigPath = legacyUserConfigPath;
      } else if (legacyResult.corrupt) {
        if (legacyResult.backupError) {
          logger.warn({ legacyUserConfigPath, err: legacyResult.backupError.message }, "Failed to rename corrupt legacy user config file");
        } else {
          logger.warn(
            { legacyUserConfigPath, backupPath: legacyResult.backupPath },
            "Corrupt legacy user config file, backed up to config.json.corrupt.bak",
          );
        }
      }
    }
  }

  let projResult: ReadConfigResult = { filePath: projConfigPath || "", exists: false, json: {}, corrupt: false, repaired: false };
  let projJson: Record<string, unknown> = {};
  let projExists = false;
  if (projConfigPath && existsSync(projConfigPath)) {
    projResult = recoverConfig(inspectConfig(projConfigPath), false);
    if (projResult.exists && !projResult.corrupt) {
      projJson = projResult.json;
      projExists = true;
    } else if (projResult.corrupt) {
      if (projResult.backupError) {
        logger.warn({ projConfigPath, err: projResult.backupError.message }, "Failed to rename corrupt project config file");
      } else {
        logger.warn(
          { projConfigPath, backupPath: projResult.backupPath },
          "Corrupt project config file, backed up to config.json.corrupt.bak and auto-recovering to defaults",
        );
      }
    }
  }

  let legacyProjectKeyBlocked = false;
  let legacyProjectKeyRemediation: string | undefined;
  const originalGlobalJson = { ...globalJson };

  // Project secret migration & blocking
  // Repository scan command for project owners to locate legacy project keys:
  // rg '"gemini(Fallback)?ApiKey"' --glob '.pi/pi-voice.json'
  // or: find . -name pi-voice.json -exec grep -H 'gemini.*ApiKey' {} +
  const projHasGeminiKey = typeof projJson.geminiApiKey === "string" && projJson.geminiApiKey.trim().length > 0;
  const projHasFallbackKey = typeof projJson.geminiFallbackApiKey === "string" && projJson.geminiFallbackApiKey.trim().length > 0;

  if (projHasGeminiKey || projHasFallbackKey) {
    if (!isStrongEncryptionAvailable()) {
      legacyProjectKeyBlocked = true;
      legacyProjectKeyRemediation = "A legacy API key was found in project config (.pi/pi-voice.json), but strong encryption is unavailable. Please move your key to global user config and remove it from .pi/pi-voice.json.";
    } else {
      const projGeminiState = projHasGeminiKey ? resolveSecretState(projJson.geminiApiKey) : null;
      const projFallbackState = projHasFallbackKey ? resolveSecretState(projJson.geminiFallbackApiKey) : null;

      if ((projGeminiState && projGeminiState.status !== "available") || (projFallbackState && projFallbackState.status !== "available")) {
        legacyProjectKeyBlocked = true;
        legacyProjectKeyRemediation = "A legacy API key in project config (.pi/pi-voice.json) could not be decrypted/migrated safely. Please move your key to global user config and remove it from .pi/pi-voice.json.";
      } else {
        // Write-before-remove migration
        if (projGeminiState?.status === "available") {
          globalJson.geminiApiKey = encryptSecret(projGeminiState.value);
        }
        if (projFallbackState?.status === "available") {
          globalJson.geminiFallbackApiKey = encryptSecret(projFallbackState.value);
        }
        try {
          atomicWriteJson(userConfigPath, globalJson, { mode: 0o600 });
          delete projJson.geminiApiKey;
          delete projJson.geminiFallbackApiKey;
          if (projConfigPath) {
            atomicWriteJson(projConfigPath, projJson);
          }
        } catch (migErr: any) {
          globalJson = originalGlobalJson;
          try {
            if (globalExists) {
              atomicWriteJson(userConfigPath, originalGlobalJson, { mode: 0o600 });
            } else if (existsSync(userConfigPath)) {
              unlinkSync(userConfigPath);
            }
          } catch (rollbackErr: any) {
            logger.error({ err: rollbackErr?.message }, "Failed to roll back legacy project key migration");
          }
          projJson = { ...projJson };
          if (projGeminiState?.status === "available") projJson.geminiApiKey = projGeminiState.ciphertext;
          if (projFallbackState?.status === "available") projJson.geminiFallbackApiKey = projFallbackState.ciphertext;
          logger.warn({ err: migErr?.message }, "Failed to complete legacy project key migration");
          legacyProjectKeyBlocked = true;
          legacyProjectKeyRemediation = "Failed to complete legacy project key migration to user config.";
        }
      }
    }
  }

  if (!legacyProjectKeyBlocked) {
    delete projJson.geminiApiKey;
    delete projJson.geminiFallbackApiKey;
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
    if ((globalResult.repaired || repairedGlobal.changed) && globalExists) {
      atomicWriteJson(userConfigPath, globalJson, { mode: 0o600 });
    }
    if ((projResult.repaired || repairedProject.changed) && projExists && projConfigPath) {
      atomicWriteJson(projConfigPath, projJson);
    }
  } catch (saveErr: any) {
    logger.warn({ err: saveErr?.message }, "Failed to auto-heal config to disk");
  }

  const mergedRaw: Record<string, unknown> = { ...globalJson, ...projJson };
  let result = configFileSchema.safeParse(mergedRaw);
  const config = result.success ? result.data : configFileSchema.parse({});

  // Resolve secret states from globalJson
  const geminiState = resolveSecretState(globalJson.geminiApiKey);
  let geminiApiKey: string | undefined;
  let geminiKeyError: string | undefined;

  if (geminiState.status === "available") {
    geminiApiKey = geminiState.value;
    if (geminiState.needsMigration) {
      try {
        globalJson.geminiApiKey = encryptSecret(geminiState.value);
        atomicWriteJson(userConfigPath, globalJson, { mode: 0o600 });
      } catch {}
    }
  } else if (geminiState.status === "decrypt-error") {
    geminiKeyError = geminiState.error;
  }

  const fallbackState = resolveSecretState(globalJson.geminiFallbackApiKey);
  let geminiFallbackApiKey: string | undefined;
  let geminiFallbackKeyError: string | undefined;

  if (fallbackState.status === "available") {
    geminiFallbackApiKey = fallbackState.value;
    if (fallbackState.needsMigration) {
      try {
        globalJson.geminiFallbackApiKey = encryptSecret(fallbackState.value);
        atomicWriteJson(userConfigPath, globalJson, { mode: 0o600 });
      } catch {}
    }
  } else if (fallbackState.status === "decrypt-error") {
    geminiFallbackKeyError = fallbackState.error;
  }

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
    { configPath: primaryPath, keyBinding: keyStr, editKeyBinding: editKeyStr, provider, geminiModel, inputGain, dictationPreset, dictationMode, translateEnabled, targetLanguage, audioChimesEnabled, symbolScannerEnabled, vocabularyCount: mergedCustomVocab.length },
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
    geminiApiKey,
    geminiFallbackApiKey,
    geminiKeyError,
    geminiFallbackKeyError,
    legacyProjectKeyBlocked: legacyProjectKeyBlocked ? true : undefined,
    legacyProjectKeyRemediation,
    audioDeviceId,
  };
}

export function loadConfig(cwd: string = process.cwd()): PiVoiceConfig {
  return withConfigLock(() => loadConfigUnlocked(cwd));
}

function atomicWriteJson(filePath: string, data: unknown, options: { mode?: number } = {}): void {
  const targetDir = dirname(filePath);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  }
  const mode = options.mode ?? 0o600;
  const tmpPath = join(targetDir, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmpPath, "wx", mode);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    chmodSync(tmpPath, mode);
    renameSync(tmpPath, filePath);
    try { chmodSync(filePath, mode); } catch {}
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { unlinkSync(tmpPath); } catch {}
  }
}

function preparePatchSave(
  existingJson: Record<string, unknown>,
  patch: PiVoiceConfigPatch,
  targetPath: string,
  isUserScope: boolean
): Record<string, unknown> {
  let baseJson = { ...existingJson };
  if (baseJson.dictationPreset === "translate" && baseJson.translateEnabled === undefined) {
    baseJson = { ...baseJson, dictationPreset: "careful", translateEnabled: true };
  }

  const patchCopy = { ...patch };

  let newGeminiApiKey: string | undefined = undefined;
  let newGeminiFallbackApiKey: string | undefined = undefined;

  if (isUserScope) {
    if (patchCopy.geminiApiKey !== undefined) {
      const trimmed = patchCopy.geminiApiKey.trim();
      newGeminiApiKey = trimmed ? encryptSecret(trimmed) : "";
    }
    if (patchCopy.geminiFallbackApiKey !== undefined) {
      const trimmed = patchCopy.geminiFallbackApiKey.trim();
      newGeminiFallbackApiKey = trimmed ? encryptSecret(trimmed) : "";
    }
  }

  delete patchCopy.geminiApiKey;
  delete patchCopy.geminiFallbackApiKey;

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

  const mergedJson: Record<string, unknown> = {
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
    ...(patchCopy.audioDeviceId !== undefined ? { audioDeviceId: patchCopy.audioDeviceId.trim() } : {}),
  };

  if (!isUserScope) {
    delete mergedJson.geminiApiKey;
    delete mergedJson.geminiFallbackApiKey;
  } else {
    if (newGeminiApiKey !== undefined) {
      if (newGeminiApiKey) {
        mergedJson.geminiApiKey = newGeminiApiKey;
      } else {
        delete mergedJson.geminiApiKey;
      }
    }
    if (newGeminiFallbackApiKey !== undefined) {
      if (newGeminiFallbackApiKey) {
        mergedJson.geminiFallbackApiKey = newGeminiFallbackApiKey;
      } else {
        delete mergedJson.geminiFallbackApiKey;
      }
    }
  }

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

interface RecoveryRequest {
  result: ReadConfigResult;
  userScope: boolean;
  label: string;
}

function restoreRecoveries(recoveries: RecoveryRequest[]): void {
  for (const { result } of [...recoveries].reverse()) {
    if (!result.backupPath || !existsSync(result.backupPath)) continue;
    if (existsSync(result.filePath)) unlinkSync(result.filePath);
    fs.renameSync(result.backupPath, result.filePath);
    chmodSync(result.filePath, result.mode ?? 0o600);
    result.backupPath = undefined;
  }
}

function backupRecoveries(requests: RecoveryRequest[]): RecoveryRequest[] {
  const completed: RecoveryRequest[] = [];
  for (const request of requests) {
    const { result, userScope, label } = request;
    if (!result.corrupt) continue;
    if (result.backupError || !result.rawBytes) {
      restoreRecoveries(completed);
      throw new ConfigError(result.filePath, `Failed to backup corrupt ${label} config file: ${result.backupError?.message || "backup failed"}`);
    }
    try {
      result.backupPath = backupCorruptConfig(result.filePath, result.rawBytes, userScope ? 0o600 : (result.mode ?? 0o600));
      completed.push(request);
    } catch (err: any) {
      restoreRecoveries(completed);
      throw new ConfigError(result.filePath, `Failed to backup corrupt ${label} config file: ${err?.message || "backup failed"}`);
    }
  }
  return completed;
}

function updateConfigUnlocked(cwd: string, patch: PiVoiceConfigPatch): PiVoiceConfig {
  const userConfigPath = getUserConfigPath();
  const legacyUserConfigPath = getLegacyUserConfigPath();
  const projConfigPath = getProjConfigPath(cwd);
  const hasProjConfig = projConfigPath ? existsSync(projConfigPath) : false;

  const userResult = inspectConfig(userConfigPath);
  const legacyResult = (!userResult.exists || userResult.corrupt)
    && userConfigPath !== legacyUserConfigPath
    && existsSync(legacyUserConfigPath)
    ? inspectConfig(legacyUserConfigPath)
    : undefined;
  const projResult = hasProjConfig && projConfigPath ? inspectConfig(projConfigPath) : undefined;

  const recoveries = backupRecoveries([
    { result: userResult, userScope: true, label: "user" },
    ...(legacyResult ? [{ result: legacyResult, userScope: true, label: "legacy user" }] : []),
    ...(projResult ? [{ result: projResult, userScope: false, label: "project" }] : []),
  ]);
  let committed = false;

  try {
    for (const { result, label } of recoveries) {
      logger.warn(
        { configPath: result.filePath, backupPath: result.backupPath },
        `Corrupt ${label} config file backed up prior to patch update`,
      );
    }

    let existingUserJson = userResult.corrupt ? {} : userResult.json;
    if ((!userResult.exists || userResult.corrupt) && legacyResult?.exists && !legacyResult.corrupt) {
      existingUserJson = legacyResult.json;
    }

    const toSaveUser = preparePatchSave(existingUserJson, patch, userConfigPath, true);
    let toSaveProj: Record<string, unknown> | undefined;
    let existingProjJson: Record<string, unknown> | undefined;

    if (projResult && projConfigPath) {
      existingProjJson = projResult.corrupt ? {} : projResult.json;
      const hasProjectGeminiKey = typeof existingProjJson.geminiApiKey === "string" && existingProjJson.geminiApiKey.trim().length > 0;
      const hasProjectFallbackKey = typeof existingProjJson.geminiFallbackApiKey === "string" && existingProjJson.geminiFallbackApiKey.trim().length > 0;
      if ((hasProjectGeminiKey && patch.geminiApiKey === undefined) || (hasProjectFallbackKey && patch.geminiFallbackApiKey === undefined)) {
        throw new ConfigError(projConfigPath, "Legacy project API keys must be migrated or explicitly cleared before updating project config");
      }
      toSaveProj = preparePatchSave(existingProjJson, patch, projConfigPath, false);
    }

    if (toSaveProj && projConfigPath && existingProjJson) {
      try {
        atomicWriteJson(projConfigPath, toSaveProj);
      } catch (err: any) {
        throw new ConfigError(projConfigPath, `Atomic write failed: ${err.message}`);
      }
    }

    try {
      atomicWriteJson(userConfigPath, toSaveUser, { mode: 0o600 });
    } catch (err: any) {
      if (toSaveProj && projConfigPath && existingProjJson) {
        try {
          if (projResult?.corrupt) unlinkSync(projConfigPath);
          else atomicWriteJson(projConfigPath, existingProjJson);
        } catch (rollbackErr: any) {
          logger.error({ err: String(rollbackErr), configPath: projConfigPath }, "Failed to roll back project config patch");
        }
      }
      throw err instanceof ConfigError
        ? err
        : new ConfigError(userConfigPath, `Atomic write failed: ${err.message}`);
    }

    committed = true;
    const vocabularySource = toSaveProj ?? toSaveUser;
    savePersistedVocabulary({
      customVocabulary: (vocabularySource.customVocabulary as string[]) || [],
      presetVocabulary: (vocabularySource.presetVocabulary as Record<string, string[]>) || {},
      entries: (vocabularySource.dictionaryEntries as DictionaryEntry[]) || [],
    });

    return loadConfigUnlocked(cwd);
  } catch (err) {
    if (!committed) restoreRecoveries(recoveries);
    throw err;
  }
}

export function updateConfig(cwd: string = process.cwd(), patch: PiVoiceConfigPatch): PiVoiceConfig {
  return withConfigLock(() => updateConfigUnlocked(cwd, patch));
}
