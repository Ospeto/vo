import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AudioStreamMeta, type RecordingFormat, type StatePayload, type GeminiModelChoice } from "./shared/types.js";

const api = {
  onStartRecording: (callback: (format: RecordingFormat, inputGain: number) => void) => {
    ipcRenderer.on(IPC.START_RECORDING, (_event, format: RecordingFormat, inputGain: number) => callback(format ?? "webm", inputGain ?? 1.0));
  },
  onStopRecording: (callback: () => void) => {
    ipcRenderer.on(IPC.STOP_RECORDING, () => callback());
  },
  onGainUpdate: (callback: (inputGain: number) => void) => {
    ipcRenderer.on(IPC.GAIN_UPDATE, (_event, inputGain: number) => callback(inputGain));
  },
  onStateChanged: (callback: (payload: StatePayload) => void) => {
    ipcRenderer.on(IPC.STATE_CHANGED, (_event, payload: StatePayload) => callback(payload));
  },
  onAudioLevelUpdate: (callback: (payload: any) => void) => {
    ipcRenderer.on(IPC.AUDIO_LEVEL_UPDATE, (_event, payload: any) => callback(payload));
  },
  onPlayAudioStreamStart: (callback: (meta: AudioStreamMeta) => void) => {
    ipcRenderer.on(IPC.PLAY_AUDIO_STREAM_START, (_event, meta: AudioStreamMeta) => callback(meta));
  },
  onPlayAudioStreamChunk: (callback: (pcmData: ArrayBuffer) => void) => {
    ipcRenderer.on(IPC.PLAY_AUDIO_STREAM_CHUNK, (_event, pcmData: ArrayBuffer) => callback(pcmData));
  },
  onPlayAudioStreamEnd: (callback: () => void) => {
    ipcRenderer.on(IPC.PLAY_AUDIO_STREAM_END, () => callback());
  },
  sendRecordingData: (data: ArrayBuffer) => {
    ipcRenderer.send(IPC.RECORDING_DATA, data);
  },
  sendRecordingError: (error: string) => {
    ipcRenderer.send(IPC.RECORDING_ERROR, error);
  },
  sendAudioLevelUpdate: (payload: any) => {
    ipcRenderer.send(IPC.AUDIO_LEVEL_UPDATE, payload);
  },
  sendPlaybackDone: () => {
    ipcRenderer.send(IPC.PLAYBACK_DONE);
  },
  getConfig: () => ipcRenderer.invoke(IPC.GET_CONFIG),
  saveConfig: (patch: { geminiModel?: GeminiModelChoice; inputGain?: number; key?: string; dictationPreset?: string; dictationMode?: string; audioChimesEnabled?: boolean }) => ipcRenderer.invoke(IPC.SAVE_CONFIG, patch),
  registerHotkey: (newKeyStr: string) => ipcRenderer.invoke(IPC.REGISTER_HOTKEY, newKeyStr),
  registerEditHotkey: (newKeyStr: string) => ipcRenderer.invoke(IPC.REGISTER_EDIT_HOTKEY, newKeyStr),
  getHistory: () => ipcRenderer.invoke(IPC.GET_HISTORY),
  clearHistory: () => ipcRenderer.invoke(IPC.CLEAR_HISTORY),
  toggleDictation: () => ipcRenderer.invoke(IPC.TOGGLE_DICTATION),
  testApiKey: (keyToTest?: string) => ipcRenderer.invoke(IPC.TEST_API_KEY, keyToTest),
  previewChime: (soundName: string) => ipcRenderer.invoke(IPC.PREVIEW_CHIME, soundName),
};

contextBridge.exposeInMainWorld("piVoice", api);
contextBridge.exposeInMainWorld("electronIPC", api);

export type PiVoiceElectronAPI = typeof api;
