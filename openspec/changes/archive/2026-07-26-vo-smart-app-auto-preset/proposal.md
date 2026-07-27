## Why

Currently, users must manually select dictation presets (`Fast`, `Code`, `Email`, `Burmese`, `Translate`) from the popover UI. Adding `auto` preset mode enables intelligent hands-free automatic preset switching based on the frontmost application:
- Code Editors & Terminals (VSCode, Cursor, Terminal, Warp, iTerm) ──► `code_comment` (Precise AI Coding Intent Catcher)
- Email & Messaging Apps (Slack, Mail, Outlook, Telegram, Teams) ──► `email_polish` (Email Polish)
- Document & Note-taking Apps (Obsidian, Notion, Bear, Pages) ──► `burmese_written` (Burmese Written Prose)

## What Changes

- Add `"auto"` option to `DictationPreset` union type in `src/services/config.ts`.
- Add `resolveEffectivePreset(preset, appName)` helper in `src/services/stt.ts` to dynamically resolve effective preset when preset is set to `auto`.
- Add `✨ Auto (Smart)` option to the Preset dropdown in `src/renderer/index.html`.
- Update unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to verify `auto` preset resolution.

## Capabilities

### New Capabilities

- `dictation-presets`: Support `auto` preset mode for dynamic application-aware preset resolution.

### Modified Capabilities

- None.

## Impact

- `src/services/config.ts`: Added `auto` to `DictationPreset` type & schema.
- `src/services/stt.ts`: Dynamic resolution helper `resolveEffectivePreset`.
- `src/renderer/index.html`: Preset selector updated with `Auto (Smart)` option.
- `src/__tests__/services/menu-bar-gui.test.ts`: Added unit tests for `auto` preset mapping.
