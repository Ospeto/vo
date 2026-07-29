import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";
import fs from "fs";
import type { Plugin } from "vite";

/**
 * Ensures each preload entrypoint is compiled as a self-contained CJS bundle
 * without Rollup generating runtime relative imports to shared chunk files
 * (e.g. out/preload/chunks/shared-*.cjs), which sandboxed preloads reject.
 */
function unsharePreloadEntriesPlugin(entries: Record<string, string>): Plugin {
  const entryPaths = new Map(Object.entries(entries).map(([k, v]) => [v, k]));

  return {
    name: "unshare-preload-entries",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer) {
        return null;
      }

      let entryScope: string | null = null;
      const match = importer.match(/\?preloadEntry=([^&]+)/);
      if (match) {
        entryScope = match[1] ?? null;
      } else {
        const cleanImporter = importer.split("?")[0];
        if (cleanImporter && entryPaths.has(cleanImporter)) {
          entryScope = entryPaths.get(cleanImporter) ?? null;
        }
      }

      if (entryScope) {
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (resolved && !resolved.external && !resolved.id.includes("node_modules") && !resolved.id.includes("?preloadEntry=")) {
          const querySep = resolved.id.includes("?") ? "&" : "?";
          return {
            ...resolved,
            id: `${resolved.id}${querySep}preloadEntry=${entryScope}`,
          };
        }
        return resolved;
      }
      return null;
    },
    load(id) {
      if (id.includes("?preloadEntry=")) {
        const cleanId = id.split("?")[0];
        if (cleanId) {
          return fs.readFileSync(cleanId, "utf8");
        }
      }
      return null;
    },
  };
}

const preloadEntries = {
  settings: resolve(__dirname, "src/preload/settings.ts"),
  capture: resolve(__dirname, "src/preload/capture.ts"),
  hud: resolve(__dirname, "src/preload/hud.ts"),
  index: resolve(__dirname, "src/preload.ts"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main.ts"),
        },
        output: {
          format: "es",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), unsharePreloadEntriesPlugin(preloadEntries)],
    build: {
      rollupOptions: {
        input: preloadEntries,
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          capture: resolve(__dirname, "src/renderer/capture.html"),
          hud: resolve(__dirname, "src/renderer/hud.html"),
        },
      },
    },
  },
});

