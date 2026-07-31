import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { $ } from "bun";
import { parseGypAssignment, parseDefine, validateElectronHeaderMetadata } from "./native-header-validation.ts";

const root = resolve(import.meta.dir, "..");
const source = resolve(root, "src/native/pi-paste-addon.c");
const outputDirectory = resolve(root, "native");
const output = resolve(outputDirectory, "pi-paste.node");
const smokeOutput = resolve(outputDirectory, "pi-paste-smoke.node");
const electronPackage = await Bun.file(resolve(root, "node_modules/electron/package.json")).json() as { version: string };
if (electronPackage.version !== "40.8.3") throw new Error(`Native addon build is pinned to Electron 40.8.3, found ${electronPackage.version}`);
const headerRoot = process.env["ELECTRON_HEADERS"] ? resolve(process.env["ELECTRON_HEADERS"]) : resolve(root, ".cache/electron-headers", electronPackage.version, "include", "node");
const archiveUrl = "https://artifacts.electronjs.org/headers/dist/v40.8.3/node-v40.8.3-headers.tar.gz";
const archiveSha256 = "61fbe26d00801c9d38012636f2080961b0f16a96cee06b052a9af5cb48d05a3a";
const headerFiles = ["node_api.h", "node.h", "config.gypi"];
const hasHeaders = async (directory: string) => (await Promise.all(headerFiles.map((file) => Bun.file(resolve(directory, file)).exists()))).every(Boolean);
const validElectron40Headers = async (directory: string) => {
  if (!(await hasHeaders(directory))) return false;
  const config = await Bun.file(resolve(directory, "config.gypi")).text();
  const version = await Bun.file(resolve(directory, "node_version.h")).text();
  return validateElectronHeaderMetadata(config, version);
};
if (!(await validElectron40Headers(headerRoot))) {
  if (process.env["ELECTRON_HEADERS"]) throw new Error(`Electron 40.8.3 header metadata mismatch at ${headerRoot}`);
  const cacheRoot = resolve(root, ".cache/electron-headers", electronPackage.version);
  const archive = resolve(cacheRoot, "headers.tar.gz");
  await mkdir(cacheRoot, { recursive: true });
  const response = await fetch(archiveUrl);
  if (!response.ok) throw new Error(`Electron header download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== archiveSha256) throw new Error("Electron header archive SHA-256 mismatch");
  await writeFile(archive, bytes);
  const listing = (await $`tar -tzf ${archive}`.text()).split("\n").filter(Boolean);
  if (listing.some((entry) => entry.startsWith("/") || entry.split("/").includes("..") || !entry.startsWith("node_headers/"))) throw new Error("Unsafe Electron header archive paths");
  const staging = await mkdtemp(resolve(cacheRoot, "extract-"));
  try {
    await $`tar -xzf ${archive} -C ${staging} --strip-components=1`;
    if (!(await validElectron40Headers(resolve(staging, "include/node")))) throw new Error("Electron header archive metadata mismatch");
    await rm(resolve(cacheRoot, "include"), { recursive: true, force: true });
    await $`mv ${resolve(staging, "include")} ${resolve(cacheRoot, "include")}`;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
const nodeHeaders = headerRoot;
if (!(await validElectron40Headers(nodeHeaders))) throw new Error(`Verified Electron ${electronPackage.version} header metadata missing at ${nodeHeaders}`);
const probeDirectory = await mkdtemp(resolve(root, ".cache/native-header-probe-"));
await writeFile(resolve(probeDirectory, "binding.gyp"), JSON.stringify({ targets: [{ target_name: "header_probe", sources: [] }] }));
try { await $`${resolve(root, "node_modules/.bin/node-gyp")} configure --nodedir=${resolve(nodeHeaders, "../..")} --directory=${probeDirectory}`; }
finally { await rm(probeDirectory, { recursive: true, force: true }); }

await mkdir(outputDirectory, { recursive: true });
await $`clang -x objective-c -shared -undefined dynamic_lookup -fPIC -arch arm64 -I${nodeHeaders} -framework AppKit -framework ApplicationServices -o ${output} ${source}`;
console.log(`Built ${output}`);

if (process.argv.includes("--self-check")) {
  const probe = await $`node -e ${`const addon = require(${JSON.stringify(output)}); if (!addon.selfCheck() || addon.smokeFixture || addon.smokeAuthorize) process.exit(1); console.log("pi-paste addon self-check ok")`}`.text();
  process.stdout.write(probe);
}

if (process.argv.includes("--smoke-addon")) {
  await $`clang -x objective-c -DPI_PASTE_TEST_MODE=1 -shared -undefined dynamic_lookup -fPIC -arch arm64 -I${nodeHeaders} -framework AppKit -framework ApplicationServices -o ${smokeOutput} ${source}`;
  console.log(`Built ${smokeOutput}`);
}
