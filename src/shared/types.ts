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
}

export interface AudioLevelPayload {
  level: number;
  spectrum?: number[];
}

export type GeminiModelChoice = "gemini-3.6-flash" | "gemini-3.5-flash-lite" | "gemini-3.1-flash-lite" | "gemini-3.1-pro" | "gemini-2.5-flash" | "gemini-2.5-pro";
export type ChimeSoundChoice = "glass" | "submarine" | "hero" | "ping" | "pop" | "tink";

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
  GAIN_UPDATE: "gain-update",
  STATE_SNAPSHOT: "state-snapshot",
  STATE_CHANGED: "state-changed",
  AUDIO_LEVEL_UPDATE: "audio-level-update",
  PLAY_AUDIO_STREAM_START: "play-audio-stream-start",
  PLAY_AUDIO_STREAM_CHUNK: "play-audio-stream-chunk",
  PLAY_AUDIO_STREAM_END: "play-audio-stream-end",

  // renderer -> main
  RECORDING_DATA: "recording-data",
  RECORDING_ERROR: "recording-error",
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

/** Exposed API in renderer via contextBridge */
export interface PiVoiceAPI {
  onStartRecording: (callback: (format: RecordingFormat) => void) => void;
  onStopRecording: (callback: () => void) => void;
  onPlayAudioStreamStart: (callback: (meta: AudioStreamMeta) => void) => void;
  onPlayAudioStreamChunk: (callback: (pcmData: ArrayBuffer) => void) => void;
  onPlayAudioStreamEnd: (callback: () => void) => void;
  sendRecordingData: (data: ArrayBuffer) => void;
  sendRecordingError: (error: string) => void;
  sendPlaybackDone: () => void;
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
    piVoice: PiVoiceAPI;
    electronIPC?: any;
    piVoiceAPI?: any;
  }
}
