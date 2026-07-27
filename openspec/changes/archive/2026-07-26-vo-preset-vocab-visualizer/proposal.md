## Why

The user requested two major GUI enhancements:
1. **Preset-Dependent Personal Vocabulary**: Custom vocabulary terms should be mapped per dictation preset (`code_comment`, `email_polish`, `burmese_written`, etc.) rather than just a static global list, ensuring exact context-specific STT accuracy.
2. **Live 60fps Web Audio Spectrum Visualizer**: Replace/augment the simple RMS meter with a dynamic 60fps HTML5 Canvas frequency spectrum visualizer in the Electron popover GUI.

## What Changes

- Update `PiVoiceConfig` & `configFileSchema` in `src/services/config.ts` to include `presetVocabulary?: Partial<Record<DictationPreset, string[]>>`.
- Update `src/services/stt.ts` to resolve preset-specific vocabulary terms based on `effectivePreset`.
- Add `presetVocabulary` IPC update handlers in `src/main.ts`, `src/preload.ts`, and `src/shared/types.ts`.
- Update `src/renderer/index.html` and `src/renderer/capture.ts` to render:
  - Dynamic 60fps Canvas audio spectrum visualizer during active recording.
  - Interactive preset-dependent vocabulary tag manager UI where users can add/remove terms per preset.
- Update unit test suite in `src/__tests__/services/menu-bar-gui.test.ts`.

## Capabilities

### New Capabilities

- `preset-vocabulary`: Preset-dependent custom vocabulary storage and STT prompt injection.
- `audio-spectrum-visualizer`: 60fps Web Audio HTML5 Canvas frequency spectrum visualizer.

### Modified Capabilities

- None.

## Impact

- `src/services/config.ts`: Added `presetVocabulary` schema support.
- `src/services/stt.ts`: Preset-dependent vocabulary resolution in `transcribeGemini`.
- `src/shared/types.ts` & `src/preload.ts` & `src/main.ts`: Added `PRESET_VOCAB_UPDATE` IPC.
- `src/renderer/index.html` & `src/renderer/capture.ts`: Spectrum Canvas visualizer + Preset Vocabulary Manager UI.
- `src/__tests__/services/menu-bar-gui.test.ts`: Unit tests for preset vocabulary resolution.
