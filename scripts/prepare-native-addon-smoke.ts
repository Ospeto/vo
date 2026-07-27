import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const destination = resolve(root, "release/mac-arm64/pi-voice.app/Contents/Resources/native");
await mkdir(destination, { recursive: true });
await copyFile(resolve(root, "native/pi-paste-smoke.node"), resolve(destination, "pi-paste.node"));
console.log(`Prepared smoke-only addon at ${destination}`);
