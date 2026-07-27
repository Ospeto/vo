## 1. Type & Prompt Configuration

- [x] 1.1 Update `src/services/config.ts` to include `translate_en` in `DictationPreset` union type and config schema validator.
- [x] 1.2 Update `getPresetPromptInstructions()` in `src/services/stt.ts` to return single-pass Burmese-to-English translation instructions for `translate_en`.

## 2. UI & Unit Testing Integration

- [x] 2.1 Update `src/renderer/index.html` to add `Translate (EN)` option to the Preset dropdown selector.
- [x] 2.2 Update unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to verify `translate_en` preset instruction resolution.
- [x] 2.3 Run full test suite via `bun test` and build production bundle via `bun run build`.
