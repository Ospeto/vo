## ADDED Requirements

### Requirement: Preset-Dependent Custom Vocabulary
The system SHALL store and resolve custom vocabulary terms scoped per dictation preset.

#### Scenario: Transcribing audio with code_comment preset
- **WHEN** dictation preset is `code_comment` and `presetVocabulary.code_comment` contains `["TypeScript", "Prisma"]`
- **THEN** STT prompt includes `Key Terms: TypeScript, Prisma`.

#### Scenario: Transcribing audio with burmese_written preset
- **WHEN** dictation preset is `burmese_written` and `presetVocabulary.burmese_written` contains `["Engram", "FSRS"]`
- **THEN** STT prompt includes `Key Terms: Engram, FSRS`.
