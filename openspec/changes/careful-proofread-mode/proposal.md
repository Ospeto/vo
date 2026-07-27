# Proposal: Careful Proofread Mode Preset

## Why
Users want a dedicated "Careful" dictation preset that prioritizes semantic meaning, grammatical perfection, and homophone correction over raw speed, allowing high-precision voice transcription for complex ideas.

## Scope
- Add `"careful"` to `DictationPreset` union type and Zod schema in `src/services/config.ts`.
- Add `careful` preset directive and model mapping (`gemini-3.6-flash`) in `src/services/stt.ts`.
- Add `"Careful Proofread"` option to preset dropdowns in `src/renderer/index.html` and `src/renderer/renderer.ts`.
- Add unit tests for `careful` preset handling in `src/__tests__/services/stt.test.ts`.

## Capabilities
### Modified Capabilities
- `careful-proofread-mode`: Enable high-precision proofreading dictation preset for maximum semantic clarity.
