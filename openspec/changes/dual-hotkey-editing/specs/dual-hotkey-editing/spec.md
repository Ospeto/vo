# Capability: Dual Hotkey Voice Architecture

## Requirement: Configurable Edit Hotkey
`config.json` SHALL support a configurable `editKey` property alongside `key`.
If omitted, `editKey` SHALL default to `ctrl+cmd+option+e`.

## Requirement: Deterministic Mode Routing
When `key` (Dictation Hotkey) is pressed:
- The app SHALL enter Pure Dictation Mode.
- If text is highlighted in the foreground application, the app SHALL overwrite the selection with the transcribed text.

When `editKey` (Voice Edit Hotkey) is pressed:
- The app SHALL enter Voice AI Edit Mode.
- The app SHALL capture the selected text.
- Gemini STT SHALL apply the spoken voice command (translate, summarize, fix) to the selected text.

## Requirement: HUD Mode Visualization
When Voice AI Edit Mode is active, the HUD capsule SHALL render a purple border glow, violet waveform, and glowing edit icon.
