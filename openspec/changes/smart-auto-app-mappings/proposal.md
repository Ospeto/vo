# Proposal: Configurable Smart Auto App Preset Mappings

## Why
Users want to customize which macOS applications map to which dictation presets (e.g. mapping Xcode to Code preset, Discord to Email preset) via a clean, non-cluttered Settings UI and persistent JSON configuration.

## Scope
- Add `appPresetMappings?: Record<string, DictationPreset>` to `PiVoiceConfig` and Zod schema in `src/services/config.ts`.
- Update `resolveEffectivePreset` in `src/services/stt.ts` to respect user-configured app mappings.
- Add collapsible Smart Auto App Rules drawer UI with add/delete controls in `src/renderer/index.html` and `src/renderer/renderer.ts`.
- Add unit tests for `appPresetMappings` resolution in `src/__tests__/services/stt.test.ts`.

## Capabilities
### Modified Capabilities
- `smart-auto-app-mappings`: Allow users to dynamically configure app-to-preset mappings for Smart Auto Mode.
