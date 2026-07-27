import { describe, expect, test } from "bun:test";
import { POST_INJECTION_CLIPBOARD_HOLD_MS, SafePasteService, createClipboardPort, createMacSafePasteService, parseTargetLine, type ClipboardSnapshot, type SafePasteDiagnostic, type TargetIdentity } from "../../services/safe-paste.js";
import type { NativePasteAddon } from "../../services/native-paste-addon.js";
import { loadNativePasteAddon } from "../../services/native-paste-addon.js";
import { parseGypAssignment, parseDefine, validateElectronHeaderMetadata } from "../../../scripts/native-header-validation.ts";

const target = (overrides: Partial<TargetIdentity> = {}): TargetIdentity => ({ bundleId: "com.example.editor", appName: "Editor", pid: 42, windowId: 7, windowTitle: "Document", ...overrides });
const clipboardFixture = (events: string[] = []) => ({
  value: "old",
  readText() { return this.value; },
  writeText(value: string) { events.push("write"); this.value = value; },
  snapshot() { events.push("snapshot"); return { text: this.value, formats: [] }; },
  restore(snapshot: ClipboardSnapshot) { events.push("restore"); this.value = snapshot.text ?? ""; },
});

describe("SafePasteService", () => {
  test("uses only the direct synchronous native paste contract", async () => {
    const source = await Bun.file(new URL("../../services/safe-paste.ts", import.meta.url)).text();
    for (const forbidden of ["timeout", "deadline", "terminationVerified", "Promise.race", "Date.now() + 1000"]) expect(source).not.toContain(forbidden);
    expect(source).not.toContain("injectPaste(this.capturedTarget,");
  });
  test("production paste sources use a direct synchronous native contract", async () => {
    const source = await Bun.file(new URL("../../services/safe-paste.ts", import.meta.url)).text();
    const addonSource = await Bun.file(new URL("../../services/native-paste-addon.ts", import.meta.url)).text();
    expect(source).not.toContain("setImmediate");
    expect(source).not.toContain("MaybePromise");
    expect(addonSource).not.toContain("setImmediate");
    for (const forbidden of ["node:child_process", "child_process", "execFile", "exec(", "spawn(", "pi-paste", "bin/pi-paste"]) {
      expect(source).not.toContain(forbidden);
      expect(addonSource).not.toContain(forbidden);
    }
  });

  test("packaged Electron smoke requires capture, authorization, mismatch rejection, and dry-run success", async () => {
    const serviceSource = await Bun.file(new URL("../../services/safe-paste.ts", import.meta.url)).text();
    expect(serviceSource).toContain("authorize");
    expect(serviceSource).toContain("inject");
    expect(serviceSource).toContain("target_mismatch");
  });

  test("production addon has no compile-time smoke fixture exports", async () => {
    const addonSource = await Bun.file(new URL("../../native/pi-paste-addon.c", import.meta.url)).text();
    expect(addonSource).toContain("#ifdef PI_PASTE_TEST_MODE");
    expect(addonSource).toContain("#endif");
    expect(addonSource.indexOf("#ifdef PI_PASTE_TEST_MODE")).toBeLessThan(addonSource.indexOf("napi_set_named_property(env, exports, \"smokeFixture\""));
  });

  test("packaged smoke selects a distinct test-only addon artifact", async () => {
    const buildSource = await Bun.file(new URL("../../../scripts/build-native-paste-addon.ts", import.meta.url)).text();
    expect(buildSource).toContain("pi-paste-smoke.node");
    expect(buildSource).toContain("PI_PASTE_TEST_MODE");
  });

  test("native build provisions exact Electron headers without private cache assumptions", async () => {
    const buildSource = await Bun.file(new URL("../../../scripts/build-native-paste-addon.ts", import.meta.url)).text();
    expect(buildSource).toContain("https://artifacts.electronjs.org/headers/dist/v40.2.1/node-v40.2.1-headers.tar.gz");
    expect(buildSource).toContain("35476b9cfe8a71494e64bbad221d42f7ed1cc8c3dee7a39a1db0bd4cbac27afe");
    expect(buildSource).toContain("--nodedir");
    expect(buildSource).toContain("electronPackage.version");
    expect(buildSource).toContain("ELECTRON_HEADERS");
    expect(buildSource).not.toContain("bunx");
    expect(buildSource).not.toContain("node-gyp install");
  });

  test("executes exact header metadata validation for valid, missing, malformed, duplicate, conflicting, and commented declarations", () => {
    const validConfig = "{\n 'built_with_electron': 1,\n 'using_electron_config_gypi': 1,\n 'node_module_version': 143,\n}";
    const validVersion = "#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 11\n#define NODE_PATCH_VERSION 1\n";
    expect(parseGypAssignment(validConfig, "built_with_electron")).toBe(1);
    expect(parseDefine(validVersion, "NODE_MAJOR_VERSION")).toBe(24);
    expect(validateElectronHeaderMetadata(validConfig, validVersion)).toBe(true);
    for (const config of ["", "{\n 'built_with_electron': nope,\n}", "{\n 'built_with_electron': 1,\n 'built_with_electron': 1,\n}", "{\n 'built_with_electron': 1,\n 'built_with_electron': 2,\n}"]) {
      expect(parseGypAssignment(config, "built_with_electron")).toBeNull();
    }
    expect(parseGypAssignment("# 'built_with_electron': 1\n{\n 'built_with_electron': 1,\n}", "built_with_electron")).toBe(1);
    for (const version of ["", "#define NODE_MAJOR_VERSION nope\n", "#define NODE_MAJOR_VERSION 24\n#define NODE_MAJOR_VERSION 24\n", "#define NODE_MAJOR_VERSION 24\n#define NODE_MAJOR_VERSION 25\n"]) {
      expect(parseDefine(version, "NODE_MAJOR_VERSION")).toBeNull();
    }
    expect(parseDefine("/* #define NODE_MAJOR_VERSION 24 */\n#define NODE_MAJOR_VERSION 24\n", "NODE_MAJOR_VERSION")).toBe(24);
    expect(validateElectronHeaderMetadata("{\n 'built_with_electron': 1,\n 'using_electron_config_gypi': 1,\n 'node_module_version': 142,\n}", validVersion)).toBe(false);
  });

  test("pins the Electron ABI and declares node-gyp directly", async () => {
    const packageJson = await Bun.file(new URL("../../../package.json", import.meta.url)).json() as { devDependencies: Record<string, string> };
    expect(packageJson.devDependencies.electron).toBe("40.2.1");
    expect(packageJson.devDependencies["node-gyp"]).toBe("12.4.0");
  });

  test("smoke authorization and smoke results use native matching, not hard-coded JS values", async () => {
    const nativeSource = await Bun.file(new URL("../../native/pi-paste-addon.c", import.meta.url)).text();
    const serviceSource = await Bun.file(new URL("../../services/safe-paste.ts", import.meta.url)).text();
    const authorize = nativeSource.slice(nativeSource.indexOf("static napi_value authorize"), nativeSource.indexOf("static napi_value inject"));
    expect(authorize).toContain("target_matches");
    expect(serviceSource).toContain("addon.authorize");
    expect(serviceSource).toContain("addon.inject");
  });

  test("packaged smoke requires native capture and exact native failure reasons", async () => {
    const serviceSource = await Bun.file(new URL("../../services/safe-paste.ts", import.meta.url)).text();
    expect(serviceSource).toContain("target_unavailable");
    expect(serviceSource).toContain("target_mismatch");
    expect(serviceSource).toContain("injection_requested");
  });

  test("normal addon service operation has no child-process invocation boundary", async () => {
    const source = await Bun.file(new URL("../../services/safe-paste.ts", import.meta.url)).text();
    expect(source).not.toMatch(/(?:execFile|exec|spawn|child_process|pi-paste)/);
    const addon: NativePasteAddon = { selfCheck: () => true, capture: () => ({ ok: true, ...target() }), authorize: () => ({ ok: true }), inject: () => ({ ok: true, reason: "injection_requested" }) };
    const service = createMacSafePasteService(addon, clipboardFixture());
    service.captureTarget();
    expect(await service.paste("hello")).toEqual({ ok: true, reason: "injection_requested" });
  });

  test("dry-run injection is non-invasive and reports a request without posting", async () => {
    let posted = false;
    const addon = {
      selfCheck: () => true,
      capture: () => ({ ok: true, ...target() }),
      authorize: () => ({ ok: true as const }),
      inject: (_target: TargetIdentity, options?: { dryRun?: boolean }) => options?.dryRun ? { ok: true as const, reason: "injection_requested" as const } : (posted = true, { ok: true as const, reason: "injection_requested" as const }),
    };
    const result = addon.inject(target(), { dryRun: true });
    expect(result).toEqual({ ok: true, reason: "injection_requested" });
    expect(posted).toBe(false);
  });

  test("uses the in-process addon in authorization and injection order", async () => {
    const events: string[] = [];
    const addon: NativePasteAddon = {
      selfCheck: () => true,
      capture: () => ({ ok: true, ...target() }),
      authorize: () => { events.push("authorize"); return { ok: true }; },
      inject: () => { events.push("inject"); return { ok: true, reason: "injection_requested" }; },
    };
    const service = createMacSafePasteService(addon, clipboardFixture(events));
    service.captureTarget();
    expect(await service.paste("transcript")).toEqual({ ok: true, reason: "injection_requested" });
    expect(events).toEqual(["authorize", "write", "inject", "write"]);
  });

  test("reports guarded addon load failure without touching clipboard", async () => {
    const clipboard = clipboardFixture();
    const service = createMacSafePasteService(null, clipboard);
    service.captureTarget();
    expect(await service.paste("secret")).toEqual({ ok: false, reason: "native_unavailable" });
    expect(clipboard.value).toBe("old");
  });

  test("guards a missing addon load without throwing during import", () => {
    expect(loadNativePasteAddon("/definitely/missing/pi-paste.node")).toBeNull();
  });

  test("calls native injection directly and restores after an actual native failure", async () => {
    const events: string[] = [];
    const received: TargetIdentity[][] = [];
    const service = new SafePasteService(
      () => target(),
      async (...args: [TargetIdentity]) => { received.push(args); throw Object.assign(new Error("native failure"), { reason: "injection_failed" }); },
      clipboardFixture(events),
      async () => {},
    );
    service.captureTarget();
    expect(await service.paste("secret")).toEqual({ ok: false, reason: "injection_failed" });
    expect(received).toEqual([[target()]]);
    expect(events).toEqual(["snapshot", "write", "restore"]);
  });

  test("holds the written transcript readable until the clipboard is restored", async () => {
    const events: string[] = [];
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => { releaseHold = resolve; });
    const clipboard = clipboardFixture(events);
    const service = new SafePasteService(
      () => target(),
      async () => { events.push("inject"); },
      clipboard,
      async () => {},
      undefined,
      async (durationMs) => { events.push(`hold:${durationMs}`); await hold; },
    );
    service.captureTarget();
    const paste = service.paste("transcript");
    await Promise.resolve();
    await Promise.resolve();
    expect(clipboard.value).toBe("transcript");
    expect(events).toEqual(["snapshot", "write", "inject", `hold:${POST_INJECTION_CLIPBOARD_HOLD_MS}`]);
    let resolved = false;
    void paste.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    releaseHold();
    expect(await paste).toEqual({ ok: true, reason: "injection_requested" });
    expect(events).toEqual(["snapshot", "write", "inject", `hold:${POST_INJECTION_CLIPBOARD_HOLD_MS}`, "restore"]);
    expect(clipboard.value).toBe("old");
  });

  test("restores immediately without a hold when injection fails", async () => {
    const events: string[] = [];
    let held = false;
    const service = new SafePasteService(
      () => target(),
      async () => { throw Object.assign(new Error("native failure"), { reason: "injection_failed" }); },
      clipboardFixture(events),
      async () => {},
      undefined,
      async () => { held = true; },
    );
    service.captureTarget();
    expect(await service.paste("transcript")).toEqual({ ok: false, reason: "injection_failed" });
    expect(events).toEqual(["snapshot", "write", "restore"]);
    expect(held).toBe(false);
  });

  test("returns clipboard_restore_failed when restoration throws", async () => {
    const clipboard = clipboardFixture();
    clipboard.restore = () => { throw new Error("restore failed"); };
    const service = new SafePasteService(() => target(), async () => {}, clipboard);
    service.captureTarget();
    expect(await service.paste("hello")).toEqual({ ok: false, reason: "clipboard_restore_failed" });
  });

  test("preserves target/app/PID/window-only matching", async () => {
    let current = target();
    const clipboard = clipboardFixture();
    const service = new SafePasteService(() => current, async () => {}, clipboard);
    service.captureTarget();
    current = target({ windowId: 8 });
    expect(await service.paste("secret")).toEqual({ ok: false, reason: "target_mismatch" });
    expect(clipboard.value).toBe("old");
  });

  test("parses optional non-authoritative title without widening target policy", () => {
    expect(parseTargetLine("com.example.editor\tEditor\t42\t7\t\n")).toEqual({ ...target(), windowTitle: undefined });
    expect(parseTargetLine("com.example.editor\tEditor\t42\t7\tDocument\textra\n")).toBeNull();
  });

  test("restores standard clipboard data through the adapter", () => {
    let text = "before";
    const port = createClipboardPort({ readText: () => text, writeText: (value: string) => { text = value; } });
    const snapshot = port.snapshot();
    port.writeText("during");
    port.restore(snapshot);
    expect(text).toBe("before");
  });

  test("tags dictation writeText with NSPasteboard transient and concealed privacy flags", () => {
    const customBuffers: Record<string, Buffer> = {};
    const clipboard = {
      value: "",
      readText() { return this.value; },
      writeText(value: string) { this.value = value; },
      writeBuffer(format: string, buffer: Buffer) { customBuffers[format] = buffer; },
    };
    const port = createClipboardPort(clipboard);
    port.writeText("Hello Privacy");

    expect(clipboard.value).toBe("Hello Privacy");
    expect(customBuffers["org.nspasteboard.TransientType"]).toBeDefined();
    expect(customBuffers["org.nspasteboard.ConcealedType"]).toBeDefined();
    expect(customBuffers["org.nspasteboard.AutoGeneratedType"]).toBeDefined();
  });

  test("fails closed when custom formats cannot be restored exactly", async () => {
    const clipboard = {
      value: "old",
      readText() { return this.value; },
      writeText(value: string) { this.value = value; },
      availableFormats: () => ["text/plain", "application/x-private"],
      readBuffer: () => Buffer.from([1, 2, 3]),
      snapshot() { return { text: this.value, formats: [{ format: "application/x-private", data: Buffer.from([1, 2, 3]) }] }; },
      restore() { throw new Error("not expected"); },
    };
    let injected = false;
    const service = new SafePasteService(() => target(), async () => { injected = true; }, createClipboardPort(clipboard));
    service.captureTarget();
    expect(await service.paste("secret")).toEqual({ ok: false, reason: "clipboard_restore_failed" });
    expect(injected).toBe(false);
  });
});
