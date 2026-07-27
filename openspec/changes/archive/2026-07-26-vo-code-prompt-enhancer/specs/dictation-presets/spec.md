## ADDED Requirements

### Requirement: AI Coding Prompt Enhancer for Code Preset
The system SHALL use a Systematic AI Coding Prompt Enhancer prompt instruction for `code_comment` preset to expand spoken Burmese technical intent into detailed, actionable English AI coding prompts.

#### Scenario: User dictates Burmese coding idea in Code preset
- **WHEN** user selects `code_comment` preset and dictates a coding requirement in Burmese
- **THEN** Gemini STT transcribes and expands the intent into a professional, single-paragraph English AI coding prompt.

#### Scenario: Prompt instructions formatting for code preset
- **WHEN** `getPresetPromptInstructions("code_comment")` is called
- **THEN** the system returns instructions for rewriting and expanding Burmese technical intent into a systematic English AI coding prompt.
