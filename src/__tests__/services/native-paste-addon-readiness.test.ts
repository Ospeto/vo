import { describe, expect, test, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { categorizeNativePasteAddonLoadError, checkNativePasteAddon, loadNativePasteAddon, resolveNativePastePath, type NativePasteAddon } from "../../services/native-paste-addon.js";
import { createMacSafePasteService, type ClipboardSnapshot, type TargetIdentity } from "../../services/safe-paste.js";

mock.module("electron", () => ({
  app: {
    name: "vo",
    setName: mock(() => {}),
    dock: { hide: mock(() => {}) },
    requestSingleInstanceLock: mock(() => true),
    on: mock(() => {}),
    whenReady: mock(async () => {}),
    quit: mock(() => {}),
    exit: mock(() => {}),
  },
  BrowserWindow: class MockBrowserWindow {
    static getAllWindows() { return []; }
    closedHandler: (() => void) | null = null;
    webContents = { send: mock(() => {}), on: mock(() => {}), once: mock(() => {}), setWindowOpenHandler: mock(() => {}) };
    isDestroyed() { return false; }
    destroy() { if (this.closedHandler) this.closedHandler(); }
    hide() {}
    showInactive() {}
    focus() {}
    loadFile() {}
    on(event: string, handler: () => void) {
      if (event === "closed") this.closedHandler = handler;
    }
    once() {}
  },
  ipcMain: { on: mock(() => {}), handle: mock(() => {}) },
  Tray: class MockTray {
    setImage() {}
    setToolTip() {}
    on() {}
    popUpContextMenu() {}
    destroy() {}
  },
  Menu: { buildFromTemplate: mock(() => ({})) },
  screen: { getPrimaryDisplay: mock(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })) },
  nativeImage: { createFromPath: mock(() => ({ setTemplateImage: mock(() => {}) })) },
  clipboard: { readText: mock(() => ""), writeText: mock(() => {}) },
  Notification: class { static isSupported() { return false; } show() {} },
  systemPreferences: { isTrustedAccessibilityClient: mock(() => false) },
  globalShortcut: { register: mock(() => true), unregisterAll: mock(() => {}) },
  default: {},
}));

const target = (overrides: Partial<TargetIdentity> = {}): TargetIdentity => ({ bundleId: "com.example.editor", appName: "Editor", pid: 42, windowId: 7, windowTitle: "Document", ...overrides });
const clipboardFixture = (events: string[] = []) => ({
  value: "old",
  readText() { return this.value; },
  writeText(value: string) { events.push("write"); this.value = value; },
  snapshot() { events.push("snapshot"); return { text: this.value, formats: [] }; },
  restore(snapshot: ClipboardSnapshot) { events.push("restore"); this.value = snapshot.text ?? ""; },
});
const validAddon: NativePasteAddon = {
  selfCheck: () => true,
  capture: () => ({ ok: true, ...target() }),
  authorize: () => ({ ok: true }),
  inject: () => ({ ok: true, reason: "injection_requested" }),
};

describe("native paste addon readiness", () => {
  test("missing addon file reports missing_file without throwing", () => {
    expect(() => loadNativePasteAddon("/definitely/missing/pi-paste.node")).not.toThrow();
    expect(loadNativePasteAddon("/definitely/missing/pi-paste.node")).toEqual({ ok: false, reason: "missing_file" });
  });

  test("load errors categorize every unavailable reason", () => {
    expect(categorizeNativePasteAddonLoadError(new Error("dlopen(/tmp/pi_paste.node, 0x0001): no suitable image found. Did find: /tmp/pi_paste.node: mach-o, but wrong architecture"))).toBe("wrong_architecture");
    expect(categorizeNativePasteAddonLoadError(new Error("dlopen failed: incompatible architecture (have 'x86_64', need 'arm64')"))).toBe("wrong_architecture");
    expect(categorizeNativePasteAddonLoadError(new Error("The module '/tmp/pi_paste.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 136."))).toBe("abi_mismatch");
    expect(categorizeNativePasteAddonLoadError(new Error("dlopen(/tmp/pi_paste.node, 0x0001): no suitable image found. Did find: /tmp/pi_paste.node: required code signature missing"))).toBe("signing_or_load_failed");
    expect(categorizeNativePasteAddonLoadError(new Error("dlopen failed: not valid for use in process using Library Validation"))).toBe("signing_or_load_failed");
    expect(categorizeNativePasteAddonLoadError("something entirely unexpected")).toBe("signing_or_load_failed");
  });

  test("valid addon passes self-check and is returned as ready", () => {
    const readiness = checkNativePasteAddon(validAddon);
    expect(readiness.ok).toBe(true);
    if (readiness.ok) expect(readiness.addon).toBe(validAddon);
  });

  test("invalid addons and failed self-checks report self_check_failed", () => {
    expect(checkNativePasteAddon(null)).toEqual({ ok: false, reason: "self_check_failed" });
    expect(checkNativePasteAddon({})).toEqual({ ok: false, reason: "self_check_failed" });
    expect(checkNativePasteAddon({ capture: () => ({}), authorize: () => ({}), inject: () => ({}), selfCheck: () => false })).toEqual({ ok: false, reason: "self_check_failed" });
  });

  test("stays stable when the loaded addon throws during self-check", () => {
    const throwing: NativePasteAddon = {
      selfCheck: () => { throw new Error("boom"); },
      capture: () => ({ ok: true, ...target() }),
      authorize: () => ({ ok: true }),
      inject: () => ({ ok: true, reason: "injection_requested" }),
    };
    expect(() => checkNativePasteAddon(throwing)).not.toThrow();
    expect(checkNativePasteAddon(throwing)).toEqual({ ok: false, reason: "self_check_failed" });
  });

  test("resolveNativePastePath checks packaged resources when no local build exists", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "vo-resolve-"));
    const resources = mkdtempSync(join(tmpdir(), "vo-resources-"));
    mkdirSync(join(resources, "native"), { recursive: true });
    writeFileSync(join(resources, "native", "pi-paste.node"), "");
    const previous = (process as any).resourcesPath;
    (process as any).resourcesPath = resources;
    try {
      expect(resolveNativePastePath(projectRoot)).toBe(join(resources, "native", "pi-paste.node"));
    } finally {
      (process as any).resourcesPath = previous;
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(resources, { recursive: true, force: true });
    }
  });

  test("resolveNativePastePath falls back to the default build path when nothing exists", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "vo-resolve-miss-"));
    try {
      expect(resolveNativePastePath(projectRoot)).toBe(join(projectRoot, "build", "Release", "pi_paste.node"));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("loadNativePasteAddon classifies files when NODE_ENV is not test", () => {
    const oldEnv = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      expect(loadNativePasteAddon("/definitely/missing/pi-paste.node")).toEqual({ ok: false, reason: "missing_file" });

      const tmpFile = join(tmpdir(), `test-addon-${Date.now()}.node`);
      writeFileSync(tmpFile, "not a native addon binary");
      const readiness = loadNativePasteAddon(tmpFile);
      expect(readiness.ok).toBe(false);
      if (!readiness.ok) {
        expect(["wrong_architecture", "abi_mismatch", "signing_or_load_failed"]).toContain(readiness.reason);
      }
      rmSync(tmpFile, { force: true });
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });

  test("fail-closed paste: unavailable readiness never touches the clipboard", async () => {
    const events: string[] = [];
    const clipboard = clipboardFixture(events);
    const service = createMacSafePasteService({ ok: false, reason: "abi_mismatch" }, clipboard);
    service.captureTarget();
    expect(await service.paste("secret")).toEqual({ ok: false, reason: "native_unavailable" });
    expect(clipboard.value).toBe("old");
    expect(events).toEqual([]);
  });

  test("ready readiness object is used as the active addon", async () => {
    const events: string[] = [];
    const addon: NativePasteAddon = { ...validAddon, inject: () => { events.push("inject"); return { ok: true, reason: "injection_requested" }; } };
    const service = createMacSafePasteService({ ok: true, addon }, clipboardFixture(events));
    service.captureTarget();
    expect(await service.paste("hello")).toEqual({ ok: true, reason: "injection_requested" });
    expect(events).toContain("inject");
  });
});

describe("daemon status native paste exposure", () => {
  test("status exposes the discriminated native paste readiness", async () => {
    const { handleDaemonCommand, nativePasteReadiness } = await import("../../main.js");
    const status = handleDaemonCommand("status");
    expect(status.ok).toBe(true);
    expect(status.nativePaste).toEqual(nativePasteReadiness.ok ? { ready: true } : { ready: false, reason: nativePasteReadiness.reason });
  });
});
