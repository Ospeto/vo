# key-validation-and-voice-macros Specification

## Purpose
TBD - created by archiving change vo-key-validation-and-voice-macros. Update Purpose after archive.
## Requirements
### Requirement: Live Gemini API Key Validation in Settings Modal

The application SHALL provide an interactive "Test Key" button in the Settings modal that sends a test request to Gemini API and displays success or error status.

#### Scenario: Validating a working Gemini API Key
- **WHEN** user inputs a valid Gemini API key and clicks "Test Key"
- **THEN** system MUST display a green success status "API Key is valid and active"

#### Scenario: Validating an invalid Gemini API Key
- **WHEN** user inputs an invalid Gemini API key and clicks "Test Key"
- **THEN** system MUST display a red error message with failure details

### Requirement: Spoken Bullet Point Formatting Macro

The application SHALL convert spoken phrases "bullet point" or "အချက်" into bulleted list format (`- `).

#### Scenario: Spoken Bullet Phrase
- **WHEN** spoken text contains "bullet point" or "အချက်" at line start
- **THEN** system MUST replace the phrase with `- `

