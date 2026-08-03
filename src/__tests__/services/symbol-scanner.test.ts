import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanWorkspaceSymbols, clearSymbolCache } from "../../services/symbol-scanner.js";

describe("symbol-scanner", () => {
  const testDir = join(tmpdir(), `pi-voice-symbol-test-${Date.now()}`);

  beforeEach(() => {
    clearSymbolCache();
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    clearSymbolCache();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (err) {
      console.error("Failed to clean symbol scanner test directory", err);
    }
  });

  test("returns empty result for invalid or root path", () => {
    const res = scanWorkspaceSymbols("/");
    expect(res.symbols).toEqual([]);
    expect(res.fileNames).toEqual([]);
  });

  test("scans exported functions, interfaces, and classes from TypeScript files", () => {
    const srcDir = join(testDir, "src");
    mkdirSync(srcDir, { recursive: true });

    const code = `
      export function resolveConfigPath(cwd: string): string { return ""; }
      export interface CustomSymbolChoice { id: string; }
      export class WorkspaceScannerService {}
      export const DEFAULT_KEY_STRING = "ctrl+cmd+v";
    `;
    writeFileSync(join(srcDir, "stt-service.ts"), code, "utf-8");

    const res = scanWorkspaceSymbols(testDir);
    expect(res.workspaceName).toBe(testDir.split("/").pop() || "");
    expect(res.fileNames).toContain("stt-service");
    expect(res.symbols).toContain("resolveConfigPath");
    expect(res.symbols).toContain("CustomSymbolChoice");
    expect(res.symbols).toContain("WorkspaceScannerService");
    expect(res.symbols).toContain("DEFAULT_KEY_STRING");
  });

  test("uses in-memory cache for consecutive scans", () => {
    const srcDir = join(testDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "demo.ts"), "export function firstFunction() {}", "utf-8");

    const first = scanWorkspaceSymbols(testDir);
    expect(first.symbols).toContain("firstFunction");

    // Add another function to disk without clearing cache
    writeFileSync(join(srcDir, "demo.ts"), "export function firstFunction() {} export function secondFunction() {}", "utf-8");

    const second = scanWorkspaceSymbols(testDir);
    // Cached result returned
    expect(second.symbols).toEqual(first.symbols);

    // Clear cache
    clearSymbolCache();
    const third = scanWorkspaceSymbols(testDir);
    expect(third.symbols).toContain("secondFunction");
  });

  test("rescans when caller requests a larger file bound", () => {
    const srcDir = join(testDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "alpha.ts"), "export function firstFunction() {}", "utf-8");
    writeFileSync(join(srcDir, "beta.ts"), "export function secondFunction() {}", "utf-8");

    const first = scanWorkspaceSymbols(testDir, 1);
    expect(first.fileNames).toHaveLength(1);

    const expanded = scanWorkspaceSymbols(testDir, 2);
    expect(expanded.fileNames).toHaveLength(2);
    expect(expanded.symbols).toContain("secondFunction");
  });
});
