# PR-13 verification summary

All commands ran on macOS arm64 in the task worktree.

- `bun test`: **575 pass, 0 fail** (`final-verification.log`)
- `bun x tsc --noEmit`: **exit 0** (`final-verification.log`)
- Provider request mocks plus remediation assertions: **48 pass, 0 fail** (`provider-mock-tests.log`)
- `bun run build:native -- --self-check`: **exit 0**, `pi-paste.node` is Mach-O arm64 (`final-native-self-check.log`, `final-verification.log`)
- `bun run build`: **exit 0** and `bunx electron-builder --mac dir`: **exit 0** (`packaged-dir.log`)
- Packaged launch/native self-check: **passed** (`packaged-launch-smoke.log`)
- `bun run dist:dmg`: **exit 0** (`dmg-smoke.log`); `hdiutil verify`: **valid** (`artifact-validation.log`)
- `bun run dist:zip`: **exit 0** (`zip-smoke.log`); `unzip -t`: **no errors** (`artifact-validation.log`)
- Final `bun audit --json`: expected exit 1 because advisories remain; before/after inventory is 101 -> 61 rows and the reachable `protobufjs`, `@protobufjs/utf8`, `undici`, and `ws` rows are absent (`audit-review.md`, `audit-final.json`).

The audit count is not treated as a vulnerability count or sole gate. Remaining advisory paths and rollback/compatibility rationale are in `audit-review.md`.
