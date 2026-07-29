# dictation-presets Specification

## Purpose
TBD - created by archiving change vo-menu-bar-gui-enhancements. Update Purpose after archive.
## Requirements
### Requirement: Dictation Preset Selection
The system SHALL provide a preset mode dropdown in the Menu Bar GUI popover allowing selection between Auto, Careful, Fast Transcribe, Code Comment, Email Polish, Burmese Written, and Translate modes.

#### Scenario: User selects Code Comment preset
- **WHEN** the user selects "Code Comment" from the preset dropdown
- **THEN** the system SHALL persist the selection and append code comment formatting instructions to subsequent Gemini STT requests; translation occurs only when `translateEnabled` is active

#### Scenario: User selects Email Polish preset
- **WHEN** the user selects "Email Polish" from the preset dropdown
- **THEN** the system SHALL persist the selection in configuration and append professional email polishing instructions to subsequent Gemini STT requests

#### Scenario: User selects Burmese Written preset
- **WHEN** the user selects "Burmese Written" from the preset dropdown
- **THEN** the system SHALL persist the selection in configuration and append natural written-prose instructions that preserve the original spoken language and embedded English technical terms to subsequent Gemini STT requests

### Requirement: Recent Dictation History
The system SHALL maintain a ring buffer of the last 5 transcriptions with one-click copy and clear history functionality in the popover UI.

#### Scenario: User copies recent dictation
- **WHEN** the user clicks the copy button on a history item
- **THEN** the system SHALL write the full transcribed text to the system clipboard and briefly display a success badge

#### Scenario: User clears dictation history
- **WHEN** the user clicks the "Clear History" button in the popover UI
- **THEN** the system SHALL empty the history buffer on disk and remove history items from the popover UI

### Requirement: Audio Feedback Chimes
The system SHALL synthesize subtle audio chimes upon starting and stopping dictation when audio feedback is enabled.

#### Scenario: User toggles audio feedback
- **WHEN** the user toggles audio feedback to ON and initiates dictation
- **THEN** the system SHALL resume Web Audio context if suspended and play a soft start chime

### Requirement: Custom Vocabulary Context
The system SHALL accept user-defined custom vocabulary terms and supply them to Gemini STT requests.

#### Scenario: User configures custom vocabulary
- **WHEN** the user adds domain terms to the vocabulary editor
- **THEN** the system SHALL sanitize the list (max 50 terms, 40 chars each) and pass them as context terms to Gemini API payloads

### Requirement: Auto-Translation Mode
The system SHALL support an independent `translateEnabled` mode and `targetLanguage` setting for translating speech into the configured target language during Speech-to-Text transcription. The legacy `translate` preset SHALL remain accepted for compatibility and SHALL resolve to the `careful` preset with translation enabled without overwriting `targetLanguage`.

When `translateEnabled` is false, dictation SHALL preserve the original spoken language; `targetLanguage` SHALL not force translation.

#### Scenario: User enables translation and speaks Burmese
- **WHEN** the user enables auto-translation and speaks Burmese audio
- **THEN** Gemini STT translates the audio into the configured target language.

#### Scenario: Legacy Translate preset migration
- **WHEN** configuration contains `dictationPreset: "translate"` without an explicit `translateEnabled` value
- **THEN** the system persists or resolves `dictationPreset: "careful"`, enables translation, and preserves the configured `targetLanguage`.

### Requirement: Code Preset Language and Formatting
The system SHALL use a Systematic Code Dictation prompt for the `code_comment` preset. With translation disabled, it SHALL preserve the spoken language while applying syntax-friendly technical formatting; with translation enabled, it SHALL produce a concise English technical specification and remove residual Burmese script from the final Gemini output.

#### Scenario: User dictates a coding idea in Code preset
- **WHEN** user selects `code_comment` preset and dictates a coding requirement
- **THEN** Gemini STT preserves the spoken language and formats the intent as a syntax-friendly technical instruction; with translation enabled, it outputs an English technical specification without Burmese script.

#### Scenario: Prompt instructions formatting for code preset
- **WHEN** `getPresetPromptInstructions("code_comment")` is called
- **THEN** the system returns detect-mode instructions for syntax-friendly technical dictation that preserve the spoken language unless translation is enabled; translation mode returns strict English-only instructions.

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
