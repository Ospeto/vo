## Why

The `vo` dictation Menu Bar GUI currently supports basic gain control, model selection, and hotkey recording. To transform `vo` into a native power-user dictation tool, users need preset dictation modes (e.g. code comment, email polish, Burmese narration), recent dictation history with one-click copy, subtle audio feedback chimes, and domain-specific custom vocabulary context.

## What Changes

- Add **Smart Dictation Presets** dropdown (`Fast Transcribe`, `Code Comment`, `Email Polish`, `Burmese Written`) that dynamically inject system prompt instructions into the Gemini STT pipeline.
- Add **Recent Dictations History** collapsible list displaying the last 5 transcriptions with timestamps and one-click copy/paste buttons.
- Add **Audio Feedback Chimes** toggle for subtle macOS-style start/stop recording sound cues.
- Add **Custom Vocabulary Manager** allowing users to specify domain-specific terms (e.g., brand names, code symbols) for enhanced transcription accuracy.

## Capabilities

### New Capabilities
- `dictation-presets`: Dynamic prompt injection modes for specialized dictation workflows.
- `dictation-history`: Local storage and UI representation of recent transcriptions with quick clipboard actions.
- `audio-feedback-chimes`: Native audio cues for eyes-free dictation state transitions.
- `custom-vocabulary-manager`: User-defined jargon and vocabulary dictionary injected into Gemini STT context.

### Modified Capabilities
- None

## Impact

- `src/renderer/index.html`: Layout updates for preset selector, history section, chime toggle, and vocabulary modal.
- `src/renderer/renderer.ts`: Event handlers for preset switching, history management, and sound triggers.
- `src/renderer/style.css`: Visual styling for history cards, preset dropdown, and audio toggles matching native Apple translucency.
- `src/services/config.ts`: Configuration persistence for selected preset, history limit, chimes enabled, and custom terms list.
- `src/services/stt.ts`: Integration of active preset and custom terms into Gemini STT request payload.
