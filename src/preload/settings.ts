import { contextBridge, ipcRenderer } from "electron";
import { IPC, type SettingsElectronAPI, type StatePayload, type AudioLevelPayload } from "../shared/types.js";
import { subscribe } from "./shared.js";
import type { PiVoiceConfigPatch } from "../services/config.js";

const api: SettingsElectronAPI = {
  getConfig: () => ipcRenderer.invoke(IPC.GET_CONFIG),
  saveConfig: (patch: PiVoiceConfigPatch) => ipcRenderer.invoke(IPC.SAVE_CONFIG, patch),
  registerHotkey: (newKeyStr: string) => ipcRenderer.invoke(IPC.REGISTER_HOTKEY, newKeyStr),
  registerEditHotkey: (newKeyStr: string) => ipcRenderer.invoke(IPC.REGISTER_EDIT_HOTKEY, newKeyStr),
  getHistory: () => ipcRenderer.invoke(IPC.GET_HISTORY),
  clearHistory: () => ipcRenderer.invoke(IPC.CLEAR_HISTORY),
  toggleDictation: () => ipcRenderer.invoke(IPC.TOGGLE_DICTATION),
  testApiKey: (keyToTest?: string) => ipcRenderer.invoke(IPC.TEST_API_KEY, keyToTest),
  previewChime: (soundName: string) => ipcRenderer.invoke(IPC.PREVIEW_CHIME, soundName),
  cancelDictation: () => {
    ipcRenderer.send(IPC.CANCEL_DICTATION);
  },
  onStateChanged: (callback: (payload: StatePayload) => void) => subscribe(IPC.STATE_CHANGED, callback),
  onAudioLevelUpdate: (callback: (payload: AudioLevelPayload | number) => void) => subscribe(IPC.AUDIO_LEVEL_UPDATE, callback),
};

contextBridge.exposeInMainWorld("piVoice", api);
