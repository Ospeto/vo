import { describe, expect, test } from "bun:test";

const lock = await Bun.file(new URL("../bun.lock", import.meta.url)).text();
const before = await Bun.file(new URL("../evidence/pr-13/audit-before.json", import.meta.url)).json() as Record<string, unknown>;
const after = await Bun.file(new URL("../evidence/pr-13/audit-after.json", import.meta.url)).json() as Record<string, unknown>;

const advisoryPackages = (audit: Record<string, unknown>) => Object.keys(audit);

describe("PR-13 dependency remediation", () => {
  test("pins the supported Electron ABI and reachable provider resolutions", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json() as { devDependencies: Record<string, string> };
    expect(manifest.devDependencies.electron).toBe("40.8.3");
    expect(lock).toContain('"electron": ["electron@40.8.3"');
    expect(lock).toContain('"protobufjs": ["protobufjs@7.6.5"');
    expect(lock).toContain('"ws": ["ws@8.21.1"');
    expect(lock).toContain('"@mariozechner/pi-ai/undici": ["undici@7.29.0"');
  });

  test("proves provider advisories were removed without treating the total as a vulnerability count", () => {
    const fixedPackages = ["@protobufjs/utf8", "protobufjs", "undici", "ws"];
    for (const packageName of fixedPackages) {
      expect(advisoryPackages(before)).toContain(packageName);
      expect(advisoryPackages(after)).not.toContain(packageName);
    }
    expect(Object.keys(after).length).toBeGreaterThan(0);
    expect(Object.keys(after).length).toBeLessThan(Object.keys(before).length);
  });
});
