# dictation-presets Specification

## Purpose
TBD - created by archiving change vo-menu-bar-gui-enhancements. Update Purpose after archive.
## Requirements
### Requirement: Dictation Preset Selection
The system SHALL provide a preset mode dropdown in the Menu Bar GUI popover allowing selection between Fast Transcribe, Code Comment, Email Polish, and Burmese Written modes.

#### Scenario: User selects Code Comment preset
- **WHEN** the user selects "Code Comment" from the preset dropdown
- **THEN** the system SHALL persist the selection in configuration and append code comment formatting instructions to subsequent Gemini STT requests

#### Scenario: User selects Email Polish preset
- **WHEN** the user selects "Email Polish" from the preset dropdown
- **THEN** the system SHALL persist the selection in configuration and append professional email polishing instructions to subsequent Gemini STT requests

#### Scenario: User selects Burmese Written preset
- **WHEN** the user selects "Burmese Written" from the preset dropdown
- **THEN** the system SHALL persist the selection in configuration and append Burmese formal written tone formatting instructions to subsequent Gemini STT requests

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

### Requirement: Translate Preset Mode
The system SHALL support `translate_en` in `DictationPreset` to convert spoken Burmese audio into fluent English text during Speech-to-Text transcription.

#### Scenario: User selects Translate preset and speaks Burmese
- **WHEN** user selects `translate_en` preset and speaks Burmese audio
- **THEN** Gemini STT transcribes and translates the audio directly into English text without Burmese script.

#### Scenario: Prompt instructions formatting
- **WHEN** `getPresetPromptInstructions("translate_en")` is called
- **THEN** the system returns a prompt string instructing direct translation to English text.

### Requirement: AI Coding Prompt Enhancer for Code Preset
The system SHALL use a Systematic AI Coding Prompt Enhancer prompt instruction for `code_comment` preset to expand spoken Burmese technical intent into detailed, actionable English AI coding prompts.

#### Scenario: User dictates Burmese coding idea in Code preset
- **WHEN** user selects `code_comment` preset and dictates a coding requirement in Burmese
- **THEN** Gemini STT transcribes and expands the intent into a professional, single-paragraph English AI coding prompt.

#### Scenario: Prompt instructions formatting for code preset
- **WHEN** `getPresetPromptInstructions("code_comment")` is called
- **THEN** the system returns instructions for rewriting and expanding Burmese technical intent into a systematic English AI coding prompt.

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

