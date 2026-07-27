## ADDED Requirements

### Requirement: Smart Auto Preset Resolution
The system SHALL support `auto` in `DictationPreset` to dynamically resolve effective dictation presets based on frontmost active application metadata.

#### Scenario: Active app is VS Code when preset is auto
- **WHEN** dictation preset is set to `auto` and active app is `Code` or `Cursor`
- **THEN** `resolveEffectivePreset("auto", "Cursor")` returns `code_comment`.

#### Scenario: Active app is Slack when preset is auto
- **WHEN** dictation preset is set to `auto` and active app is `Slack` or `Mail`
- **THEN** `resolveEffectivePreset("auto", "Slack")` returns `email_polish`.

#### Scenario: Active app is Obsidian when preset is auto
- **WHEN** dictation preset is set to `auto` and active app is `Obsidian`
- **THEN** `resolveEffectivePreset("auto", "Obsidian")` returns `burmese_written`.
