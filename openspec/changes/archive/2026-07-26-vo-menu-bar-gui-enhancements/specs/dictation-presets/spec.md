## ADDED Requirements

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
