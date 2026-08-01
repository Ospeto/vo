# PR-13 verification summary

All commands ran on macOS arm64 in the task worktree.

- Fresh complete gate: `bun test` **575 pass, 0 fail**, `bun x tsc --noEmit` **exit 0**, and `bun run build` **exit 0** (`complete-gate.log`; every explicit exit marker is 0).
- Provider request mocks plus remediation assertions: **49 pass, 0 fail** (`post-gate-checks.log`; the earlier focused run is in `provider-mock-tests.log`).
- Native addon self-check: **exit 0**, `pi-paste.node` is Mach-O arm64 (`post-gate-checks.log`, `final-native-self-check.log`).
- Packaged build and launch/native self-check: **exit 0/passed** (`post-gate-checks.log`, `packaged-launch-smoke.log`).
- Fresh repository DMG/zip scripts: `bun run dist:dmg` **exit 0** and `bun run dist:zip` **exit 0** (`post-gate-dmg.log`, `post-gate-zip.log`); fresh `hdiutil verify` and `unzip -t` both **exit 0** (`post-gate-artifacts.log`).
- Final `bun audit --json`: expected exit 1 because advisories remain; before/after inventory is 101 -> 61 rows and the reachable `protobufjs`, `@protobufjs/utf8`, `undici`, and `ws` rows are absent (`audit-review.md`, `audit-final.json`).

The audit count is not treated as a vulnerability count or sole gate. Remaining advisory paths and rollback/compatibility rationale are in `audit-review.md`.
