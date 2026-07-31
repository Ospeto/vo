import { contextBridge, ipcRenderer } from "electron";
import { IPC, type CaptureElectronAPI, type RecordingFormat } from "../shared/types.js";
import { createRecordingErrorPayload } from "../services/recording-error.js";
import { subscribe } from "./shared.js";

const api: CaptureElectronAPI = {
  getConfig: () => ipcRenderer.invoke(IPC.GET_CONFIG),
  sendRecordingData: (data: ArrayBuffer) => {
    ipcRenderer.send(IPC.RECORDING_DATA, data);
  },
  sendRecordingError: (error: string, sequenceId: number) => {
    ipcRenderer.send(IPC.RECORDING_ERROR, createRecordingErrorPayload(error, sequenceId));
  },
  sendRecordingStartReady: (sequenceId: number) => {
    ipcRenderer.send(IPC.RECORDING_START_READY, { sequenceId });
  },
  sendRecordingStartFailed: (sequenceId: number, error: string) => {
    ipcRenderer.send(IPC.RECORDING_START_FAILED, { sequenceId, error });
  },
  sendRecordingStopped: (sequenceId: number) => {
    ipcRenderer.send(IPC.RECORDING_STOPPED, { sequenceId });
  },
  sendAudioLevelUpdate: (payload: any) => {
    ipcRenderer.send(IPC.AUDIO_LEVEL_UPDATE, payload);
  },
  onStartRecording: (callback: (format: RecordingFormat, inputGain: number, sequenceId: number) => void) =>
    subscribe(IPC.START_RECORDING, (format: any, inputGain: any, sequenceId: any) => callback(format ?? "webm", inputGain ?? 1.0, sequenceId)),
  onStopRecording: (callback: (ensureMinimumDuration?: boolean) => void) => subscribe(IPC.STOP_RECORDING, callback),
  onCancelRecording: (callback: () => void) => subscribe(IPC.CANCEL_RECORDING, callback),
  onGainUpdate: (callback: (inputGain: number) => void) => subscribe(IPC.GAIN_UPDATE, callback),
};

contextBridge.exposeInMainWorld("piVoice", api);
