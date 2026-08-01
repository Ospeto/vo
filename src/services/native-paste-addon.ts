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

export type NativePasteAddonUnavailableReason = "missing_file" | "wrong_architecture" | "abi_mismatch" | "signing_or_load_failed" | "self_check_failed";
export type NativePasteAddonReadiness = { ok: true; addon: NativePasteAddon } | { ok: false; reason: NativePasteAddonUnavailableReason };

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

const LOAD_ERROR_REASONS: ReadonlyArray<readonly [NativePasteAddonUnavailableReason, RegExp]> = [
  ["wrong_architecture", /wrong architecture|incompatible architecture|bad cpu type|wrong elf class|invalid elf header|not a valid mach-o|mach-o, but wrong architecture/i],
  ["abi_mismatch", /node_module_version|compiled against a different (node|electron) version|module version mismatch|did not self-register|abi mismatch/i],
  ["signing_or_load_failed", /code signature|signature (invalid|missing|verification)|library validation|not valid for use in process/i],
];

export function categorizeNativePasteAddonLoadError(error: unknown): NativePasteAddonUnavailableReason {
  const message = error instanceof Error ? error.message : String(error);
  for (const [reason, pattern] of LOAD_ERROR_REASONS) {
    if (pattern.test(message)) return reason;
  }
  return "signing_or_load_failed";
}

export function checkNativePasteAddon(addon: unknown): NativePasteAddonReadiness {
  const candidate = addon as NativePasteAddon | null;
  if (!candidate || typeof candidate.capture !== "function" || typeof candidate.authorize !== "function" || typeof candidate.inject !== "function") {
    return { ok: false, reason: "self_check_failed" };
  }
  try {
    if (candidate.selfCheck() !== true) return { ok: false, reason: "self_check_failed" };
  } catch {
    return { ok: false, reason: "self_check_failed" };
  }
  return { ok: true, addon: candidate };
}

export function loadNativePasteAddon(path: string): NativePasteAddonReadiness {
  if (!path || !existsSync(path)) return { ok: false, reason: "missing_file" };
  let loaded: unknown;
  try {
    loaded = createRequire(import.meta.url)(path);
  } catch (error) {
    return { ok: false, reason: categorizeNativePasteAddonLoadError(error) };
  }
  return checkNativePasteAddon(loaded);
}
