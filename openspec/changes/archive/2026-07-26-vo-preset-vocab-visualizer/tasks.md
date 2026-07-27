## 1. Config & Service Layer

- [x] 1.1 Update `src/services/config.ts` to add `presetVocabulary?: Partial<Record<DictationPreset, string[]>>` to `PiVoiceConfig` and Zod schema.
- [x] 1.2 Update `src/services/stt.ts` to resolve and merge preset-dependent vocabulary terms in `transcribeGemini`.
- [x] 1.3 Add IPC handlers in `src/shared/types.ts`, `src/preload.ts`, and `src/main.ts` for dynamic preset vocabulary updates.

## 2. Popover UI & Audio Spectrum Visualizer

- [x] 2.1 Update `src/renderer/index.html` to add HTML5 Spectrum Canvas and Preset Vocabulary Manager UI section.
- [x] 2.2 Update `src/renderer/capture.ts` to implement 60fps Web Audio Spectrum Visualizer and Preset Vocabulary Tag Editor.
- [x] 2.3 Update unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to verify preset vocabulary resolution.
- [x] 2.4 Run full test suite via `bun test` and rebuild production bundle via `bun run build`.
