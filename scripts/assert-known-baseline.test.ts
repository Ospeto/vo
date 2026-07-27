import { expect, test } from "bun:test";
import { compareMultisets, parseDiagnostics } from "./assert-known-baseline.ts";

test("compares diagnostics as counted multisets", () => {
  expect(compareMultisets(["same", "same"], ["same"])).toEqual({ unexpected: ["same"], missing: [] });
  expect(compareMultisets(["same"], ["same", "same"])).toEqual({ unexpected: [], missing: ["same"] });
});

test("preserves TS diagnostic details", () => {
  const result = parseDiagnostics(
    "typecheck",
    "file.ts(1,1): error TS2769: No overload matches this call.\n  Detail A\nfile.ts(1,1): error TS2769: Different detail\n",
  );
  expect(result.unparsed).toEqual([]);
  expect(result.diagnostics).toEqual([
    "file.ts(1,1): error TS2769: No overload matches this call.\n  Detail A",
    "file.ts(1,1): error TS2769: Different detail",
  ]);
});

test("reports failure-shaped output that was not parsed", () => {
  expect(parseDiagnostics("test:full", "(fail) malformed\n").unparsed).toEqual(["(fail) malformed"]);
  expect(parseDiagnostics("typecheck", "error: compiler failed\n").unparsed).toEqual(["error: compiler failed"]);
});

[
  ["panic: runtime exploded"],
  ["fatal: worker exited unexpectedly"],
  ["runner crashed before producing a summary"],
].forEach(([output]) => {
  test(`rejects unsupported test runner output: ${output}`, () => {
    expect(parseDiagnostics("test:full", output!)).toEqual({ diagnostics: [], unparsed: [output!] });
  });
});

test("rejects unrecognized residual output", () => {
  expect(parseDiagnostics("test:full", "unexpected runner output\n").unparsed).toEqual([
    "unexpected runner output",
  ]);
  expect(parseDiagnostics("test:full", "✗ 1 test failed\n").unparsed).toEqual(["✗ 1 test failed"]);
  expect(parseDiagnostics("typecheck", "FAILED: compiler output format changed\n").unparsed).toEqual([
    "FAILED: compiler output format changed",
  ]);
});
