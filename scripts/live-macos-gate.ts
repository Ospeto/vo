import { access, constants, mkdtemp, readdir, rm, writeFile, rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadNativePasteAddon } from "../src/services/native-paste-addon.js";
import { createMacSafePasteService, type ClipboardSnapshot } from "../src/services/safe-paste.js";

const execFileAsync = promisify(execFile);

async function findAppBundles(directory: string): Promise<string[]> {
  const bundles: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      bundles.push(path);
    } else if (entry.isDirectory()) {
      bundles.push(...await findAppBundles(path));
    }
  }
  return bundles;
}

const mockClipboard = () => {
  const events: string[] = [];
  let value = "original_clipboard_text";
  return {
    events,
    get value() { return value; },
    readText() { return value; },
    writeText(text: string) { events.push("write"); value = text; },
    snapshot() { events.push("snapshot"); return { text: value, formats: [] }; },
    restore(snap: ClipboardSnapshot) { events.push("restore"); value = snap.text ?? ""; },
  };
};

if (process.platform !== "darwin") {
  console.log("macOS live gate skipped: platform is not darwin");
  process.exit(0);
}

const releaseDirectory = resolve(process.argv[2] ?? "dist");
const appBundles = await findAppBundles(releaseDirectory);

if (appBundles.length === 0) {
  throw new Error(`No .app bundle found in ${releaseDirectory}`);
}

const appBundle = appBundles[0]!;
const contentsDirectory = join(appBundle, "Contents");
const macOSDirectory = join(contentsDirectory, "MacOS");
const appExecutable = join(macOSDirectory, "vo");
const resourcesDirectory = join(contentsDirectory, "Resources");
const nativePastePath = join(resourcesDirectory, "native", "pi-paste.node");
const backupPath = join(resourcesDirectory, "native", "pi-paste.node.bak");

console.log(`Starting live macOS gate on ${appBundle}`);

// 1. Valid arm64 package reports ready
const profile1 = await mkdtemp(join(tmpdir(), "pi-voice-live-smoke-1-"));
try {
  const smoke1 = await execFileAsync(appExecutable, ["--no-sandbox", "--headless", "--user-data-dir", profile1], { timeout: 10000 });
  if (!smoke1.stdout.includes("native paste addon self-check ok")) {
    throw new Error(`Valid package self-check failed: ${smoke1.stdout}${smoke1.stderr}`);
  }
  console.log("1. Valid arm64 package reported ready!");
} finally {
  await rm(profile1, { recursive: true, force: true });
}

// 2. Removed addon reports missing_file unavailable state and preserves fail-closed paste
console.log("2. Testing removed addon & fail-closed paste...");
await rename(nativePastePath, backupPath);
try {
  const profile2 = await mkdtemp(join(tmpdir(), "pi-voice-live-smoke-2-"));
  try {
    await execFileAsync(appExecutable, ["--no-sandbox", "--headless", "--user-data-dir", profile2], { timeout: 10000 });
    throw new Error("Removed addon unexpectedly succeeded!");
  } catch (err: any) {
    const stderr = err?.stderr ?? String(err);
    if (!stderr.includes("missing_file")) {
      throw new Error(`Expected missing_file in stderr, got: ${stderr}`);
    }
  } finally {
    await rm(profile2, { recursive: true, force: true });
  }

  const readiness = loadNativePasteAddon(nativePastePath);
  if (readiness.ok || readiness.reason !== "missing_file") {
    throw new Error(`Expected missing_file readiness on removed path, got: ${JSON.stringify(readiness)}`);
  }
  const cb = mockClipboard();
  const service = createMacSafePasteService(readiness, cb);
  service.captureTarget();
  const pasteRes = await service.paste("secret transcript text");
  if (pasteRes.ok || pasteRes.reason !== "native_unavailable") {
    throw new Error(`Expected fail-closed native_unavailable paste result, got: ${JSON.stringify(pasteRes)}`);
  }
  if (cb.value !== "original_clipboard_text" || cb.events.length > 0) {
    throw new Error("Removed addon paste mutated clipboard!");
  }
  console.log("2. Removed addon reported missing_file and preserved fail-closed paste!");

  // 3. Corrupted addon reports actionable unavailable state and preserves fail-closed paste
  console.log("3. Testing corrupted addon & fail-closed paste...");
  await writeFile(nativePastePath, "corrupt addon header bytes");
  const profile3 = await mkdtemp(join(tmpdir(), "pi-voice-live-smoke-3-"));
  try {
    await execFileAsync(appExecutable, ["--no-sandbox", "--headless", "--user-data-dir", profile3], { timeout: 10000 });
    throw new Error("Corrupted addon unexpectedly succeeded!");
  } catch (err: any) {
    const stderr = err?.stderr ?? String(err);
    if (!stderr.includes("signing_or_load_failed") && !stderr.includes("self_check_failed")) {
      throw new Error(`Expected signing_or_load_failed or self_check_failed in stderr, got: ${stderr}`);
    }
  } finally {
    await rm(profile3, { recursive: true, force: true });
  }

  const corruptReadiness = loadNativePasteAddon(nativePastePath);
  if (corruptReadiness.ok) {
    throw new Error("Corrupted addon unexpectedly reported ready!");
  }
  const cb2 = mockClipboard();
  const corruptService = createMacSafePasteService(corruptReadiness, cb2);
  corruptService.captureTarget();
  const corruptPasteRes = await corruptService.paste("secret transcript text");
  if (corruptPasteRes.ok || corruptPasteRes.reason !== "native_unavailable") {
    throw new Error(`Expected fail-closed native_unavailable corrupt paste result, got: ${JSON.stringify(corruptPasteRes)}`);
  }
  if (cb2.value !== "original_clipboard_text" || cb2.events.length > 0) {
    throw new Error("Corrupted addon paste mutated clipboard!");
  }
  console.log("3. Corrupted addon reported actionable unavailable state & preserved fail-closed paste!");
} finally {
  // Restore backup
  await rm(nativePastePath, { force: true });
  await rename(backupPath, nativePastePath);
}

// 4. Verify restored package succeeds again
const profile4 = await mkdtemp(join(tmpdir(), "pi-voice-live-smoke-4-"));
try {
  const smoke4 = await execFileAsync(appExecutable, ["--no-sandbox", "--headless", "--user-data-dir", profile4], { timeout: 10000 });
  if (!smoke4.stdout.includes("native paste addon self-check ok")) {
    throw new Error(`Restored package self-check failed: ${smoke4.stdout}${smoke4.stderr}`);
  }
  console.log("4. Restored arm64 package verified ok!");
} finally {
  await rm(profile4, { recursive: true, force: true });
}

console.log("Live macOS gate passed successfully!");
