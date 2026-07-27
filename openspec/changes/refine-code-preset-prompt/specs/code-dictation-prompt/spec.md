# Spec Delta: Code Dictation Prompt Directives

## Added Requirements

### Requirement: Systematic & Anti-Hallucination Prompt Directives
The `code_comment` dictation preset MUST instruct the model to transcribe and translate spoken Burmese/English dictation with 100% fidelity to the developer's intent, without inventing unsaid state management, unsaid code blocks, or extra architectural steps.

#### Scenario: Spoken Code Instruction Dictation
- **Given** the user selects the `code_comment` dictation preset
- **When** spoken Burmese or English dictation is received
- **Then** the prompt instruction MUST instruct Gemini to output direct, concise, systematic English engineering imperatives matching exact user intent without added unsaid frameworks.

#### Scenario: Casing & Identifier Formatting
- **Given** spoken dictation containing casing cues (e.g. "camel case user id", "snake case created at")
- **When** Gemini transcribes the audio
- **Then** identifiers MUST be formatted precisely as code symbols (`userId`, `created_at`) while keeping surrounding text verbatim and un-improvised.
