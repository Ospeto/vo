import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveNativePastePath } from "../../services/native-paste-path.js";

describe("resolveNativePastePath", () => {
  test("resolves the development addon from the app root", () => {
    expect(resolveNativePastePath({ isPackaged: false, appPath: "/project", resourcesPath: "/ignored" })).toBe("/project/native/pi-paste.node");
  });
  test("resolves the addon from a packaged resources path", async () => {
    const packagedResources = await mkdtemp(join(tmpdir(), "pi-voice-packaged-"));
    try {
      const packagedNative = join(packagedResources, "native");
      await Bun.$`mkdir -p ${packagedNative}`;
      const sourceAddonPath = join(import.meta.dir, "../../../native/pi-paste.node");
      if (await Bun.file(sourceAddonPath).exists()) {
        await cp(sourceAddonPath, join(packagedNative, "pi-paste.node"));
      } else {
        await Bun.write(join(packagedNative, "pi-paste.node"), "mock binary");
      }
      const helperPath = resolveNativePastePath({ isPackaged: true, appPath: join(packagedResources, "app.asar"), resourcesPath: packagedResources });
      expect(await Bun.file(helperPath).exists()).toBe(true);
    } finally {
      await rm(packagedResources, { recursive: true, force: true });
    }
  });
});
