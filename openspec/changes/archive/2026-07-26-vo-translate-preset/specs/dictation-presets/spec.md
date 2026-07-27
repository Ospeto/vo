## ADDED Requirements

### Requirement: Translate Preset Mode
The system SHALL support `translate_en` in `DictationPreset` to convert spoken Burmese audio into fluent English text during Speech-to-Text transcription.

#### Scenario: User selects Translate preset and speaks Burmese
- **WHEN** user selects `translate_en` preset and speaks Burmese audio
- **THEN** Gemini STT transcribes and translates the audio directly into English text without Burmese script.

#### Scenario: Prompt instructions formatting
- **WHEN** `getPresetPromptInstructions("translate_en")` is called
- **THEN** the system returns a prompt string instructing direct translation to English text.
