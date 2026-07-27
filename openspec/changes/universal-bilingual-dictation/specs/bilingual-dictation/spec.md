# Spec Delta: Universal Natural Bilingual Dictation Directives

## Added Requirements

### Requirement: Natural Bilingual Dictation in General Modes
Presets `fast`, `auto`, `burmese_written`, and `email_polish` MUST preserve natural spoken Burmese in Burmese script (မြန်မာစာ) and spoken English technical jargon, code identifiers, acronyms, and CLI commands in exact English.

#### Scenario: Mixed Tech-Burmese Dictation in Fast/Auto Mode
- **Given** the user is using `fast`, `auto`, `burmese_written`, or `email_polish` preset
- **When** the spoken audio contains mixed Burmese natural prose and English technical terms
- **Then** the transcribed text MUST preserve Burmese prose in Burmese characters and English technical terms in pure English without forced translation.

#### Scenario: Pure English Modes Preservation
- **Given** the user selects `code_comment` or `translate_en` preset
- **When** spoken Burmese or mixed audio is dictated
- **Then** the output MUST remain pure English text with zero Burmese script.
