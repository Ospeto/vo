# PR-13 dependency audit review

## Method and limits

- Baseline: `bun audit --json` captured in `audit-before.json` before any version change; the lockfile and full tree were captured in `dependency-tree-before.txt`.
- Final: `bun audit --json` captured in `audit-after.json` after Electron 40.8.5 and the provider-path lockfile resolutions. `audit-after-electron.json` preserves the first 40.8.3 intermediate; its remaining Electron rows were not accepted as fixed, so the final line moved to 40.8.5.
- The raw Bun advisory total is an inventory of package/version matches, not a count of proven exploitable vulnerabilities in vo. Reachability below is based on the lockfile paths and the code paths imported by vo; an advisory may still require an untrusted input or an unused optional feature.
- `bun audit` exits 1 when advisories remain. That is expected here and is not used as the sole pass/fail criterion.

| audit stage | packages | advisory rows | severity summary |
|---|---:|---:|---|
| before | 23 | 101 | critical 4, high 49, moderate 38, low 10 |
| after | 18 | 57 | critical 3, high 34, moderate 16, low 4 |

## Reviewed classification

Each row groups all advisory IDs reported for the same package; therefore every ID in the row has the stated classification. `after` lists IDs still reported after remediation. IDs absent from `after` are resolved by the Electron upgrade or the provider-path lockfile resolution.

| package and installed version after | dependency path / classification | before advisory IDs | after advisory IDs | rationale |
|---|---|---|---|---|
| `@babel/core@7.29.0` | `electron-vite@3.1.0` -> dev `vo`; **build-only** | 1123528 | 1123528 | Renderer/build transform dependency; not shipped as an application runtime module. |
| `@mariozechner/pi-coding-agent@0.52.7` | direct dependency -> `src/services/pi-session.ts`; **packaged-runtime reachable** | 1123902, 1123905, 1123907 | 1123902, 1123905, 1123907 | The package is imported by the packaged main process. The reported extension-temp, auth-write, and HTML-export features are not invoked by vo's session integration; upstream advisory ranges still include the current package, so this remains a documented compatibility limitation rather than a count-based “fixed” claim. |
| `@protobufjs/utf8@1.1.2` | `@google/genai@1.40.0` -> `protobufjs@7.6.5`; **provider-path reachable** | 1118933 | — | Provider dependency updated with protobufjs 7.6.5 and its compatible helper resolutions. |
| `ajv@8.17.1` | `@mariozechner/pi-ai@0.52.7` -> `ajv`; **provider-path reachable** | 1113715 | 1113715 | Schema validation used by the pi provider layer; no compatible direct provider release was available that removed this advisory without an unrelated upgrade. |
| `app-builder-lib@25.1.8` | `electron-builder@25.1.8` (dev); **build-only** | 1124279 | 1124279 | Packaging implementation is not part of the application bundle/runtime. |
| `basic-ftp@5.1.0` | `@mariozechner/pi-ai` -> `proxy-agent` -> `pac-proxy-agent` -> `get-uri`; **provider-path reachable** | 1118825, 1113518, 1116454, 1117083 | same | Optional proxy/FTP transport dependency. vo does not select FTP, but the dependency is reachable if provider traffic is configured through that proxy path. |
| `brace-expansion@2.0.2` | Electron-builder/glob packaging tree; **build-only** | 1130588, 1130589, 1115541, 1123896 | same | Used by packaging/build globs, not application runtime. |
| `builder-util-runtime@9.2.10` | `app-builder-lib` -> `electron-builder`; **build-only** | 1124278 | same | Electron-builder publishing/update helper is only used while packaging. |
| `electron@40.8.5` | direct dev dependency, packaged executable; **packaged-runtime reachable** | 18 Electron IDs (1116039, 1116043, 1116047, 1116051, 1116055, 1116059, 1116062, 1116066, 1116070, 1116074, 1116082, 1116086, 1116090, 1116110, 1116258, 1116319, 1117454, 1117457) | — | 40.8.5 is the compatible fixed 40.8.x line: the intermediate 40.8.3 still matched four Electron advisories (`<40.8.4`/`<40.8.5`) and was rejected before final verification. |
| `fast-uri@3.1.0` | `ajv`/`ajv-formats` -> `@mariozechner/pi-ai`; **provider-path reachable** | 1130178, 1117884, 1117870, 1124064 | same | Provider schema URI validation dependency. |
| `fast-xml-parser@5.3.4` | AWS SDK XML builder -> `@mariozechner/pi-ai`; **provider-path reachable** | 1117911, 1113568, 1113569, 1114153, 1115339, 1116307 | same | Bedrock/provider transport path; build-chain changes were intentionally not mixed into this PR. |
| `file-type@21.3.0` | `@mariozechner/pi-coding-agent`; **packaged-runtime reachable** | 1114301, 1114726 | same | Loaded by the packaged pi session dependency; no direct provider/build-only substitute was added. |
| `ip-address@10.1.0` | proxy-agent -> socks; **provider-path reachable** | 1118827 | same | Optional provider proxy transport path. |
| `minimatch@10.1.2` | pi-coding-agent plus electron-builder paths; **packaged-runtime reachable** | 1113465, 1113466, 1113544, 1113545, 1113552, 1113553 | same | The shared resolution is used by the packaged pi dependency; the duplicate packaging path is also build-only. |
| `picomatch@4.0.3` | Vite/tinyglobby and node-gyp; **build-only** | 1115551, 1115554 | same | Renderer/build and native build tooling only. |
| `postcss@8.5.6` | Vite -> electron-vite; **build-only** | 1117015, 1124252, 1124288 | same | CSS transform dependency is not shipped in the app runtime. |
| `protobufjs@7.6.5` | `@google/genai@1.40.0` -> provider client; **provider-path reachable** | 12 IDs (1118641, 1118924, 1118926, 1118928, 1118930, 1118932, 1118935, 1119378, 1117571, 1123488, 1123492, 1123964) | — | Updated only within the existing `^7.5.4` range to the latest fixed 7.x resolution; helper packages were updated only where required by its package metadata. |
| `rollup@4.57.1` | Vite -> electron-vite; **build-only** | 1113515 | 1113515 | Renderer bundler only; no build-chain major upgrade was demonstrated or included. |
| `tar@7.5.22` (plus build-tree `tar@6.2.1`) | node-gyp and electron-builder/rebuild; **build-only** | 12 IDs (1112659, 1113300, 1113375, 1114200, 1114302, 1120782, 1114680, 1123939, 1123940, 1123941, 1123942, 1124287) | same | Native rebuild and packaging extraction only; no packaged runtime path. Both resolutions remain rollback-safe under the lockfile. |
| `undici@7.29.0` (provider nested; build `undici@6.28.0` has no matching rows) | `@mariozechner/pi-ai` -> `undici`; **provider-path reachable** | 11 IDs (1114591, 1114593, 1114637, 1114639, 1114641, 1114643, 1121241, 1121244, 1121249, 1121254, 1121428) | — | Updated the nested provider resolution from 7.21.0 to 7.29.0 within `^7.19.1`; the node-gyp build resolution remains separately pinned at 6.28.0. |
| `vite@6.4.1` | electron-vite peer/build dependency; **build-only** | 1120784, 1116229, 1116234, 1123525 | same | Dev server/bundler only; not included in packaged app runtime. |
| `ws@8.21.1` | `@google/genai` and OpenAI optional peer; **provider-path reachable** | 1119108, 1123259 | — | Updated within the existing `^8.18.0` provider range. |
| `yaml@2.8.2` | pi-coding-agent plus Vite optional peer; **packaged-runtime reachable** | 1115556 | same | Pi session/config dependency is packaged; Vite's duplicate use is build-only. |

## Compatibility and rollback

- The lockfile is the rollback boundary: the Electron change is committed separately from the provider-path resolution change, and all provider changes remain in existing semver ranges. Reverting the lockfile/package commit restores the prior resolutions without a blanket major upgrade.
- Electron 40.8.5 keeps the existing ABI module version 143 and uses Node 24.14.0 headers. `scripts/build-native-paste-addon.ts` validates the exact Electron version, verified header archive SHA-256, and header metadata before compiling the arm64 addon.
- Remaining advisories are intentionally not “cleared” by upgrading Electron-builder/Vite/pi major lines. Those changes require separate compatibility evidence and would violate PR-13 scope. The raw reduction from 101 to 57 is evidence of resolved package matches, not proof that 44 advisories are exploitable or that 57 are exploitable.
