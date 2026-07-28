# preset-vocabulary Specification

## Purpose
Define preset-scoped vocabulary as provider hints, with trusted dictionary corrections
applied locally after transcription.
## Requirements
### Requirement: Preset-Dependent Custom Vocabulary
The system SHALL store and resolve custom vocabulary terms scoped per dictation preset.
Preset vocabulary SHALL be presented to Gemini as soft hints only; it MUST NOT be
treated as an instruction to invent or force a term. The trusted dictionary is the
authoritative source for deterministic local corrections shared by every STT provider.

#### Scenario: Transcribing audio with code_comment preset
- **WHEN** dictation preset is `code_comment` and `presetVocabulary.code_comment` contains `["TypeScript", "Prisma"]`
- **THEN** the Gemini prompt includes `TypeScript` and `Prisma` as possible target
  spellings, and local trusted-dictionary correction runs after transcription.

#### Scenario: Transcribing audio with burmese_written preset
- **WHEN** dictation preset is `burmese_written` and `presetVocabulary.burmese_written` contains `["Engram", "FSRS"]`
- **THEN** the Gemini prompt includes `Engram` and `FSRS` as possible target
  spellings, and local trusted-dictionary correction runs after transcription.
