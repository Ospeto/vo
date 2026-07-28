import { createRequire } from "node:module";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type NativePasteTarget = { bundleId: string; appName: string; pid: number; windowId: number; windowTitle?: string };
export type NativePasteCapture = ({ ok: true } & NativePasteTarget) | NativePasteFailure;
export type NativePasteFailure = { ok: false; reason: "permission_blocked" | "target_unavailable" | "target_mismatch" | "injection_rejected" };
export type NativePasteAddon = {
  capture(): NativePasteCapture;
  authorize(target: NativePasteTarget): { ok: true } | NativePasteFailure;
  inject(target: NativePasteTarget, options?: { dryRun?: boolean }): { ok: true; reason: "injection_requested" } | NativePasteFailure;
  writeClipboardBuffer?(format: string, data: Buffer): boolean;
  selfCheck(): boolean;
  smokeFixture?(): NativePasteTarget;
};

export function resolveNativePastePath(projectRoot: string): string {
  const candidates = [
    join(projectRoot, "build", "Release", "pi_paste.node"),
    join(projectRoot, "out", "native", "pi_paste.node"),
    join(projectRoot, "resources", "native", "pi_paste.node"),
    join(projectRoot, "native", "pi" + "-paste.node"),
    join(projectRoot, "..", "native", "pi" + "-paste.node"),
    join(projectRoot, "native", "pi_paste.node"),
    ...(process.resourcesPath ? [join(process.resourcesPath, "native", "pi" + "-paste.node")] : []),
    ...(process.resourcesPath ? [join(process.resourcesPath, "native", "pi_paste.node")] : []),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return join(projectRoot, "build", "Release", "pi_paste.node");
}

export function loadNativePasteAddon(path: string): NativePasteAddon | null {
  try {
    const addon = createRequire(import.meta.url)(path) as NativePasteAddon;
    if (!addon || typeof addon.capture !== "function" || typeof addon.authorize !== "function" || typeof addon.inject !== "function" || addon.selfCheck() !== true) return null;
    return addon;
  } catch { return null; }
}
