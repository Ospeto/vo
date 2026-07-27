# Spec Delta: Careful Proofread Mode Preset

## Added Requirements

### Requirement: Careful Proofreading Preset
The system MUST provide a "Careful" dictation preset that routes audio through high-reasoning Gemini models (`gemini-3.6-flash`) with proofreading system prompts to produce semantically rich and grammatically flawless output.

#### Scenario: Careful Dictation Proofreading
- **Given** the user selects the "Careful Proofread" preset
- **When** speech audio is dictated and transcribed
- **Then** the transcription MUST be proofread for semantic meaning and grammar while preserving core intent.
