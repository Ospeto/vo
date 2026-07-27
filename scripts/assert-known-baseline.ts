export type Baseline = Record<"test:full" | "typecheck", string[]>;

export function compareMultisets(actual: string[], expected: string[]): { unexpected: string[]; missing: string[] } {
  const actualCounts = new Map<string, number>();
  const expectedCounts = new Map<string, number>();
  for (const item of actual) actualCounts.set(item, (actualCounts.get(item) ?? 0) + 1);
  for (const item of expected) expectedCounts.set(item, (expectedCounts.get(item) ?? 0) + 1);

  const unexpected: string[] = [];
  const missing: string[] = [];

  const allKeys = new Set([...actualCounts.keys(), ...expectedCounts.keys()]);
  for (const key of allKeys) {
    const a = actualCounts.get(key) ?? 0;
    const e = expectedCounts.get(key) ?? 0;
    if (a > e) {
      for (let i = 0; i < a - e; i++) unexpected.push(key);
    } else if (e > a) {
      for (let i = 0; i < e - a; i++) missing.push(key);
    }
  }

  return { unexpected, missing };
}

export function parseDiagnostics(kind: keyof Baseline, output: string): { diagnostics: string[]; unparsed: string[] } {
  const diagnostics: string[] = [];
  const unparsed: string[] = [];

  if (!output.trim()) return { diagnostics: [], unparsed: [] };

  const lines = output.split("\n");
  let currentDiag: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "" && i === lines.length - 1) continue;

    if (kind === "test:full") {
      const match = line.match(/^\(fail\) (.+?) \[[^\n]*\]$/);
      if (match) {
        diagnostics.push(match[1]!);
      } else {
        if (line.trim().length > 0) {
          unparsed.push(line);
        }
      }
    } else {
      const match = line.match(/^([^\n]+): error (TS\d+): ([^\n]*)/);
      if (match) {
        if (currentDiag !== null) {
          diagnostics.push(currentDiag);
        }
        const [, location, code, message] = match;
        if (code === "TS2769" && message?.startsWith("No overload")) {
          currentDiag = `${location}: error ${code}: No overload matches this call.`;
        } else if (code === "TS2339") {
          currentDiag = `${location}: error ${code}: ${message!.replace(/ on type .+$/, " on type")}`;
        } else {
          currentDiag = `${location}: error ${code}: ${message}`;
        }
      } else if (currentDiag !== null && line.startsWith("  ")) {
        currentDiag += "\n" + line;
      } else {
        if (currentDiag !== null) {
          diagnostics.push(currentDiag);
          currentDiag = null;
        }
        if (line.trim().length > 0) {
          unparsed.push(line);
        }
      }
    }
  }

  if (currentDiag !== null) {
    diagnostics.push(currentDiag);
  }

  return { diagnostics, unparsed };
}
