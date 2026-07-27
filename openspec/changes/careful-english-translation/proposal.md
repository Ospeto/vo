# Proposal: Careful Deep Proofreading for English Translation Presets

## Why
Users want English translation presets (`translate_en` & `code_comment`) to perform deep Careful-style proofreading and grammar polishing when translating Burmese dictation into English text, ensuring high-quality, professional English output.

## Scope
- Update `getPresetPromptInstructions` for `translate_en` and `code_comment` in `src/services/stt.ts` to incorporate Careful Deep Proofreading directives.
- Update `getFallbackModelChain` in `src/services/stt.ts` to include `gemini-3.6-flash` in the fallback chain for `translate_en`.
- Update unit tests in `src/__tests__/services/stt.test.ts`.

## Capabilities
### Modified Capabilities
- `careful-english-translation`: Apply Careful deep proofreading directives to English translation dictation presets.
