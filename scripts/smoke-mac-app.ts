import { access, constants, mkdtemp, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

async function findAppBundles(directory: string): Promise<string[]> {
  const bundles: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      // Do not descend into Electron's nested helper bundles.
      bundles.push(path);
    } else if (entry.isDirectory()) {
      bundles.push(...await findAppBundles(path));
    }
  }
  return bundles;
}

async function fileDescription(path: string): Promise<string> {
  const { stdout } = await execFileAsync("file", [path]);
  return stdout.trim();
}

function assertArm64(description: string, path: string): void {
  if (!/arm64/.test(description)) {
    throw new Error(`Expected arm64 binary at ${path}; file reported: ${description}`);
  }
}

if (process.platform !== "darwin") {
  console.log("macOS artifact smoke test skipped: platform is not darwin");
  process.exit(0);
}

const releaseDirectory = resolve(process.argv[2] ?? "release");
const appBundles = await findAppBundles(releaseDirectory);

if (appBundles.length === 0) {
  throw new Error(`No .app bundle found in ${releaseDirectory}`);
}
if (appBundles.length > 1) {
  throw new Error(`Expected one .app bundle in ${releaseDirectory}, found: ${appBundles.join(", ")}`);
}

const appBundle = appBundles[0];
if (!appBundle) throw new Error(`No app bundle found in ${releaseDirectory}`);
const contentsDirectory = join(appBundle, "Contents");
const macOSDirectory = join(contentsDirectory, "MacOS");
const appExecutables = (await readdir(macOSDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => join(macOSDirectory, entry.name));
if (appExecutables.length !== 1) {
  throw new Error(`Expected one app executable in ${macOSDirectory}, found ${appExecutables.length}`);
}
const appExecutable = appExecutables[0];
if (!appExecutable) throw new Error(`No app executable found in ${macOSDirectory}`);

const resourcesDirectory = join(contentsDirectory, "Resources");
const appAsar = join(resourcesDirectory, "app.asar");
const nativePaste = join(resourcesDirectory, "native", "pi-paste.node");
const externalHelper = join(resourcesDirectory, "bin", "pi-paste");

await access(appAsar, constants.R_OK);
await access(nativePaste, constants.R_OK);
try {
  await access(externalHelper, constants.F_OK);
  throw new Error(`Packaged artifact unexpectedly contains external helper: ${externalHelper}`);
} catch (error) {
  if (error instanceof Error && !String(error.message).includes("ENOENT")) throw error;
}
assertArm64(await fileDescription(appExecutable), appExecutable);
assertArm64(await fileDescription(nativePaste), nativePaste);

const smokeProfile = await mkdtemp(join(tmpdir(), "pi-voice-native-smoke-"));
try {
  const smoke = await execFileAsync(appExecutable, ["--no-sandbox", "--headless", "--user-data-dir", smokeProfile], { timeout: 10000 });
  if (!smoke.stdout.includes("native paste addon self-check ok")) throw new Error(`Electron-main addon self-check failed: ${smoke.stdout}${smoke.stderr}`);
} finally { await rm(smokeProfile, { recursive: true, force: true }); }

console.log(`macOS artifact smoke test passed: ${appBundle}`);
