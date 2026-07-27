## 1. Asset Creation & Main Process Integration

- [x] 1.1 Generate `tray-recording.png` (16x16) and `tray-recording@2x.png` (32x32) assets in `src/assets/`.
- [x] 1.2 Update `setState` in `src/main.ts` to switch tray icon image based on state (`starting`/`recording` vs `idle`).

## 2. Verification & Build

- [x] 2.1 Run full test suite via `bun test` and ensure 100% pass rate.
- [x] 2.2 Rebuild production bundle via `bun run build`, restart daemon, and repackage DMG via `bun run dist:dmg`.
- [x] 2.3 Archive change proposal via `openspec archive vo-dynamic-tray-icon --yes`.
