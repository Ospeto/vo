import { contextBridge, ipcRenderer } from "electron";
import { IPC, type HudElectronAPI, type StatePayload, type AudioLevelPayload } from "../shared/types.js";
import { subscribe } from "./shared.js";

const api: HudElectronAPI = {
  cancelDictation: () => {
    ipcRenderer.send(IPC.CANCEL_DICTATION);
  },
  onStateChanged: (callback: (payload: StatePayload) => void) => subscribe(IPC.STATE_CHANGED, callback),
  onAudioLevelUpdate: (callback: (payload: AudioLevelPayload | number) => void) => subscribe(IPC.AUDIO_LEVEL_UPDATE, callback),
};

contextBridge.exposeInMainWorld("piVoice", api);
