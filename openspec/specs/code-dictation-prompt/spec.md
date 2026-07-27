# code-dictation-prompt Specification

## Purpose
TBD - created by archiving change vo-code-comment-prompt-hardening. Update Purpose after archive.
## Requirements
### Requirement: Hardened Code Dictation Prompt System Instructions

The `code_comment` dictation preset SHALL provide hardened prompt instructions in `src/services/stt.ts` that map spoken Burmese technical dictation to direct English imperative coding commands (SVO order), support spoken naming conventions, and prohibit conversational preamble or wrapping code fences.

#### Scenario: Imperative SVO Transformation and Identifier Naming
- **WHEN** user speaks Burmese technical dictation under `code_comment` preset
- **THEN** the model output MUST be formatted as a concise, precise English imperative coding instruction with proper identifier formatting (e.g. `userId`, `created_at`) and zero conversational preamble

