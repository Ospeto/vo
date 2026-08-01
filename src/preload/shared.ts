import type { IpcRendererEvent } from "electron";

export interface SubscribableIpcRenderer {
  on: (channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void) => void;
  removeListener: (channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void) => void;
}

function getIpcRenderer(): SubscribableIpcRenderer | undefined {
  if (typeof globalThis !== "undefined" && (globalThis as any).ipcRenderer) {
    return (globalThis as any).ipcRenderer as SubscribableIpcRenderer;
  }
  try {
    if (typeof require === "function") {
      const electron = require("electron");
      return (electron?.ipcRenderer || electron) as SubscribableIpcRenderer;
    }
  } catch {}
  return undefined;
}

export function subscribe<T = unknown>(channel: string, callback: (...args: T[]) => void): () => void {
  const ipc = getIpcRenderer();
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...(args as T[]));
  if (ipc && typeof ipc.on === "function") {
    ipc.on(channel, handler);
  }
  return () => {
    if (ipc && typeof ipc.removeListener === "function") {
      ipc.removeListener(channel, handler);
    }
  };
}
