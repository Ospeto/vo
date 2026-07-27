# Proposal: Universal Natural Bilingual Dictation Engine

## Why
Software developers naturally dictate in mixed Burmese natural language combined with English technical terms, identifiers, brand names, and CLI commands. Except for dedicated pure English modes (`code_comment` and `translate_en`), all general dictation modes (`fast`, `auto`, `burmese_written`, `email_polish`) should support natural bilingual dictation without forcing full translation or corrupting English technical jargon into Burmese script.

## Scope
- Update `getPresetPromptInstructions` in `src/services/stt.ts` to inject a Global Natural Bilingual Dictation Directive for `fast`, `auto`, `burmese_written`, and `email_polish` presets.
- Preserve pure English outputs strictly for `code_comment` (AI coding spec) and `translate_en` (English translation).
- Ensure all other modes preserve spoken Burmese in clean Burmese script while maintaining English technical terms, acronyms, and code identifiers in pure English.
- Add unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to verify the bilingual prompt contract.

## Capabilities
### Modified Capabilities
- `bilingual-dictation`: Enable natural mixed Burmese + English technical dictation across all non-translation dictation presets.
