import { join } from "node:path";

export type NativePastePathOptions = { isPackaged: boolean; appPath: string; resourcesPath: string };

export function resolveNativePastePath(options: NativePastePathOptions): string {
  const filename = "pi-paste.node";
  if (!options.isPackaged) return join(options.appPath, "native", filename);
  return join(options.resourcesPath, "native", filename);
}
