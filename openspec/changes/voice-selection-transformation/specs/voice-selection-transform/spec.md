## ADDED Requirements

### Requirement: Active Text Selection Detection
The system SHALL attempt to capture any highlighted text selection in the active application upon recording start.

#### Scenario: Text is selected in active app
- **WHEN** user highlights text in any application and triggers recording start
- **THEN** the system SHALL capture the selected text string and set active selection mode

#### Scenario: No text is selected
- **WHEN** no text is highlighted and user triggers recording start
- **THEN** the system SHALL proceed with standard dictation mode

### Requirement: Contextual Voice Selection Transformation Prompting
The system SHALL construct a specialized prompt combining the captured selection text and spoken audio instruction.

#### Scenario: Processing selection transformation instruction
- **WHEN** audio transcription completes in selection mode
- **THEN** Gemini 3.1 Flash Lite SHALL process the spoken instruction relative to the selection text and return only the replacement text

### Requirement: In-Place Text Replacement
The system SHALL replace the active selection with transformed text via clipboard injection.

#### Scenario: Pasting transformed replacement text
- **WHEN** selection transformation resolves successfully
- **THEN** the system SHALL paste the transformed output into the focused element, replacing the original selection
