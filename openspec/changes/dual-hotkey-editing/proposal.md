# Proposal: Dual Hotkey Voice Architecture (Pure Dictation vs Voice AI Editing)

## Intent
Provide 100% deterministic separation between Pure Voice Dictation (which overwrites/appends text) and Voice AI Selection Editing (which runs AI text transformation/translation commands). Users can configure both hotkeys independently in `config.json`.

## Scope
- Add `editKey` parameter to `PiVoiceConfig` Zod schema and `config.json` (Default: `ctrl+cmd+option+e`).
- Update `HotkeyService` and `FnHook` to register both `key` (Dictation Hotkey) and `editKey` (Voice Edit Hotkey).
- Update recording start flow:
  - When `key` is pressed: Pure Dictation Mode. If text selection exists, overwrite/replace selection with pure dictation.
  - When `editKey` is pressed: Voice AI Edit Mode. Capture selection and apply AI transformation/translation commands to selection.
- Update HUD Indicator visual feedback for Dictation Mode (Red/Green) vs Voice AI Edit Mode (Purple Glow + Edit Icon).
- Full unit test coverage for config schema, hotkey service, and dual-mode routing.
