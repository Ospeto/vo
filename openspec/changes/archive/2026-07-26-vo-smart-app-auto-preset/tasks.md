## 1. Config & Core Resolution Helper

- [x] 1.1 Update `src/services/config.ts` to include `auto` in `DictationPreset` union type and config schema validator.
- [x] 1.2 Implement `resolveEffectivePreset(preset, appName)` in `src/services/stt.ts` to dynamically resolve effective preset when `auto` is selected.

## 2. UI & Testing Integration

- [x] 2.1 Update `src/renderer/index.html` to add `Auto (Smart)` option to the Preset dropdown selector.
- [x] 2.2 Update unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to verify `auto` preset resolution across app categories.
- [x] 2.3 Run full test suite via `bun test` and build production bundle via `bun run build`.
