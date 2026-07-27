# Spec Delta: Careful Deep Proofreading for English Translation

## Added Requirements

### Requirement: Careful English Translation Directives
The system MUST include Careful Deep Proofreading directives when executing `translate_en` and `code_comment` presets, ensuring translated English output is grammatically polished and free of phonetic/speech errors.

#### Scenario: Translating Burmese to English with Careful Directives
- **Given** user speaks Burmese audio under `translate_en` or `code_comment` preset
- **When** Gemini processes the dictation
- **Then** the prompt MUST instruct Gemini to perform careful deep proofreading on the English translation output.
