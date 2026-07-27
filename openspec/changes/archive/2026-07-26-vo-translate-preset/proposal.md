## Why

Users who dictate in Burmese often want to paste fluent English text into their code editors, terminal, emails, or chat applications. Currently, `vo` only transcribes spoken Burmese into Burmese Unicode or fast English technical terms, requiring manual translation afterwards. Adding a native `translate_en` preset enables instant single-pass Speech-to-English translation with ultra-fast ~450ms latency powered by Gemini 3.1 Flash Lite.

## What Changes

- Add `translate_en` to `DictationPreset` union type in `src/services/config.ts`.
- Update `getPresetPromptInstructions()` in `src/services/stt.ts` to instruct Gemini STT to directly transcribe and translate spoken Burmese audio into fluent, natural English text.
- Add `🌐 Translate (EN)` option to the Preset dropdown in `src/renderer/index.html`.
- Update unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to cover the new preset.

## Capabilities

### New Capabilities

- `dictation-presets`: Support `translate_en` mode for single-pass Burmese-to-English spoken translation.

### Modified Capabilities

- None.

## Impact

- `src/services/config.ts`: Added `translate_en` option to `DictationPreset`.
- `src/services/stt.ts`: Dynamic system prompt addition for `translate_en`.
- `src/renderer/index.html`: Preset selector dropdown updated with `Translate (EN)` option.
- `src/__tests__/services/menu-bar-gui.test.ts`: Added test cases for `translate_en` prompt instruction.
