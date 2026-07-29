import { ipcRenderer } from "electron";

export function subscribe<T = any>(channel: string, callback: (...args: T[]) => void): () => void {
  const handler = (_event: any, ...args: T[]) => callback(...args);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}
