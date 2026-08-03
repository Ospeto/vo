import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import logger from "./logger.js";

export interface SymbolScanResult {
  workspaceName: string;
  symbols: string[];
  fileNames: string[];
}

interface CacheEntry {
  timestamp: number;
  maxFiles: number;
  data: SymbolScanResult;
  refreshing: boolean;
}

const CACHE_TTL_MS = 30_000; // 30 seconds
const cache = new Map<string, CacheEntry>();

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".c", ".cpp", ".h"]);
const EXCLUDE_DIRS = new Set(["node_modules", "dist", "build", ".git", ".next", "out", "coverage", ".venv", "target"]);

export function scanWorkspaceSymbols(workspacePath: string, maxFiles = 40): SymbolScanResult {
  if (!workspacePath || workspacePath === "/" || !existsSync(workspacePath)) {
    return { workspaceName: "", symbols: [], fileNames: [] };
  }

  const cached = cache.get(workspacePath);
  if (cached && maxFiles <= cached.maxFiles) {
    if (Date.now() - cached.timestamp >= CACHE_TTL_MS && !cached.refreshing) {
      const refreshEntry = cached;
      refreshEntry.refreshing = true;
      setTimeout(() => {
        // A larger synchronous scan may have replaced this entry already.
        if (cache.get(workspacePath) !== refreshEntry) return;
        try {
          performWorkspaceScan(workspacePath, refreshEntry.maxFiles);
        } finally {
          if (cache.get(workspacePath) === refreshEntry) {
            refreshEntry.refreshing = false;
          }
        }
      }, 0);
    }
    return cached.data;
  }

  return performWorkspaceScan(workspacePath, maxFiles);
}

function performWorkspaceScan(workspacePath: string, maxFiles = 40): SymbolScanResult {
  const workspaceName = basename(workspacePath);
  const symbols = new Set<string>();
  const fileNames = new Set<string>();

  let filesScanned = 0;

  function traverse(dir: string, depth = 0) {
    if (depth > 3 || filesScanned >= maxFiles) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (filesScanned >= maxFiles) break;

        const name = entry.name;
        if (name.startsWith(".") && name !== ".env") continue;
        if (EXCLUDE_DIRS.has(name)) continue;

        const fullPath = join(dir, name);

        if (entry.isDirectory()) {
          traverse(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(name).toLowerCase();
          if (CODE_EXTENSIONS.has(ext)) {
            filesScanned++;
            const baseName = basename(name, ext);
            if (baseName.length > 2) fileNames.add(baseName);

            try {
              const content = readFileSync(fullPath, "utf-8");
              extractSymbolsFromContent(content, symbols);
            } catch (err) {
              // ignore unreadable file
            }
          }
        }
      }
    } catch (err) {
      logger.debug({ err: String(err), dir }, "Error traversing workspace directory for symbols");
    }
  }

  traverse(workspacePath);

  const result: SymbolScanResult = {
    workspaceName,
    symbols: Array.from(symbols).slice(0, 60),
    fileNames: Array.from(fileNames).slice(0, 30),
  };

  cache.set(workspacePath, {
    timestamp: Date.now(),
    maxFiles,
    data: result,
    refreshing: false,
  });
  return result;
}

function extractSymbolsFromContent(content: string, outSymbols: Set<string>) {
  const exportRegex = /export\s+(?:async\s+)?(?:function|class|interface|type|const|enum|struct)\s+([A-Za-z0-9_$]+)/g;
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(content)) !== null) {
    const symbol = match[1];
    if (symbol && symbol.length > 2 && !isStandardKeyword(symbol)) {
      outSymbols.add(symbol);
    }
  }
}

function isStandardKeyword(word: string): boolean {
  const common = new Set(["default", "main", "test", "index", "App", "Props", "State", "Handler", "Config", "Result"]);
  return common.has(word);
}

export function clearSymbolCache(): void {
  cache.clear();
}
