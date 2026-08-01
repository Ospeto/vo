import type { PiVoiceConfigPatch } from "../services/config.js";
import type { HistoryEntry } from "../services/history-service.js";

export type VocabularyCategory = "general" | "person_name" | "technical";

export interface DictionaryEntry {
  id: string;
  phrase: string;
  spokenAliases: string[];
  enabled: boolean;
  legacyWhitespace?: boolean;
  category?: VocabularyCategory;
}

/** Application state machine */
export type AppState =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export interface StatePayload {
  state: AppState;
  message?: string;
  sequenceId?: number;
  usedPaidKey?: boolean;
  hasSelection?: boolean;
}

export interface AudioLevelPayload {
  level: number;
  spectrum?: number[];
}

export type GeminiModelChoice = "gemini-3.6-flash" | "gemini-3.5-flash-lite" | "gemini-3.1-flash-lite" | "gemini-3.1-pro" | "gemini-2.5-flash" | "gemini-2.5-pro";
export type ChimeSoundChoice = "glass" | "submarine" | "hero" | "ping" | "pop" | "tink";

export interface KeyBinding {
  keycode: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type SpeechProvider = "local" | "gemini" | "openai" | "elevenlabs";
export type DictationPreset = "auto" | "careful" | "code_comment" | "fast" | "email_polish" | "burmese_written" | "translate";
export type DictationMode = "toggle" | "hold";

/**
 * Recording format sent from main to renderer.
 * - "webm": MediaRecorder with audio/webm;codecs=opus (for cloud providers)
 * - "pcm":  Raw 16kHz mono Float32 PCM via Web Audio API (for local Whisper)
 */
export type RecordingFormat = "webm" | "pcm";

/** IPC channel names */
export const IPC = {
  // main -> renderer
  START_RECORDING: "start-recording",
  STOP_RECORDING: "stop-recording",
  CANCEL_RECORDING: "cancel-recording",
  GAIN_UPDATE: "gain-update",
  STATE_SNAPSHOT: "state-snapshot",
  STATE_CHANGED: "state-changed",
  AUDIO_LEVEL_UPDATE: "audio-level-update",
  PLAY_AUDIO_STREAM_START: "play-audio-stream-start",
  PLAY_AUDIO_STREAM_CHUNK: "play-audio-stream-chunk",
  PLAY_AUDIO_STREAM_END: "play-audio-stream-end",

  // renderer -> main
  CANCEL_DICTATION: "cancel-dictation",
  RECORDING_DATA: "recording-data",
  RECORDING_ERROR: "recording-error",
  RECORDING_START_READY: "recording-start-ready",
  RECORDING_START_FAILED: "recording-start-failed",
  RECORDING_STOPPED: "recording-stopped",
  PLAYBACK_DONE: "playback-done",
  GET_CONFIG: "get-config",
  SAVE_CONFIG: "save-config",
  REGISTER_HOTKEY: "register-hotkey",
  REGISTER_EDIT_HOTKEY: "register-edit-hotkey",
  TOGGLE_POPOVER: "toggle-popover",
  GET_HISTORY: "get-history",
  CLEAR_HISTORY: "clear-history",
  TOGGLE_DICTATION: "toggle-dictation",
  TEST_API_KEY: "test-api-key",
  PREVIEW_CHIME: "preview-chime",
} as const;

/** Audio stream metadata sent at the start of a streaming TTS session */
export interface AudioStreamMeta {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export type RendererRole = "settings" | "capture" | "hud";

export interface CaptureConfigPayload {
  audioDeviceId?: string;
  autoEndpointEnabled?: boolean;
  transcriptionDelaySec?: number;
  inputGain?: number;
  dictationMode?: DictationMode;
}

export interface SettingsConfigPayload {
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
  audioDeviceId?: string;
  hasGeminiKey: boolean;
  hasGeminiFallbackKey: boolean;
  hasOpenAIKey?: boolean;
  geminiKeyError?: string;
  geminiFallbackKeyError?: string;
  legacyProjectKeyBlocked?: boolean;
  legacyProjectKeyRemediation?: string;
}

export interface SettingsElectronAPI {
  getConfig: () => Promise<SettingsConfigPayload>;
  saveConfig: (patch: PiVoiceConfigPatch) => Promise<SettingsConfigPayload>;
  registerHotkey: (newKeyStr: string) => Promise<{ success: boolean; keyDisplay?: string; error?: string; binding?: KeyBinding; nativeKeyUpAvailable?: boolean; fallbackRegistered?: boolean }>;
  registerEditHotkey: (newKeyStr: string) => Promise<{ success: boolean; keyDisplay?: string; error?: string; binding?: KeyBinding; nativeKeyUpAvailable?: boolean; fallbackRegistered?: boolean }>;
  getHistory: () => Promise<HistoryEntry[]>;
  clearHistory: () => Promise<HistoryEntry[]>;
  toggleDictation: () => Promise<{ success: boolean; error?: string }>;
  testApiKey: (keyToTest?: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  previewChime: (soundName: string) => Promise<{ success: boolean }>;
  cancelDictation: () => void;
  onStateChanged: (callback: (payload: StatePayload) => void) => () => void;
  onAudioLevelUpdate: (callback: (payload: AudioLevelPayload | number) => void) => () => void;
}

export interface CaptureElectronAPI {
  getConfig: () => Promise<CaptureConfigPayload>;
  sendRecordingData: (data: ArrayBuffer) => void;
  sendRecordingError: (error: string, sequenceId: number) => void;
  sendRecordingStartReady?: (sequenceId: number, deviceStatus?: string) => void;
  sendRecordingStartFailed?: (sequenceId: number, error: string) => void;
  sendRecordingStopped?: (sequenceId: number) => void;
  sendAudioLevelUpdate: (payload: AudioLevelPayload | number) => void;
  onStartRecording: (callback: (format: RecordingFormat, inputGain: number, sequenceId: number) => void) => () => void;
  onStopRecording: (callback: (ensureMinimumDuration?: boolean) => void) => () => void;
  onCancelRecording: (callback: () => void) => () => void;
  onGainUpdate: (callback: (inputGain: number) => void) => () => void;
}

export interface HudElectronAPI {
  cancelDictation: () => void;
  onStateChanged: (callback: (payload: StatePayload) => void) => () => void;
  onAudioLevelUpdate: (callback: (payload: AudioLevelPayload | number) => void) => () => void;
}

export type RecordingLifecycleState = "idle" | "starting" | "recording" | "stopping" | "transcribing" | "error";

export interface RecordingLifecycleSnapshot {
  state: RecordingLifecycleState;
  sequenceId: number;
}

export type RecordingLifecycleResult =
  | { accepted: true; state: RecordingLifecycleState; sequenceId: number; action?: "start" | "stop"; snapshot?: RecordingLifecycleSnapshot }
  | { accepted: false; sequenceId: number; state?: RecordingLifecycleState; reason?: string; error?: string; snapshot?: RecordingLifecycleSnapshot };

declare global {
  interface Window {
    piVoice: SettingsElectronAPI | CaptureElectronAPI | HudElectronAPI;
  }
}
