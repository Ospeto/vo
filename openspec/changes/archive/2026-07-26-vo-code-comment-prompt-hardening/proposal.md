## Why

When developers speak technical Burmese dictation for coding (e.g., in Cursor or Antigravity IDE), Burmese SOV (Subject-Object-Verb) grammar structure, spoken variable naming conventions, and implicit context can result in unorganized English prompts or extra preamble. Hardening the `code_comment` prompt instruction ensures high-precision English imperative coding commands, zero conversational fluff, and accurate spoken naming convention handling.

## What Changes

- **Harden `code_comment` System Instructions**: Enhance the system prompt for `code_comment` dictation preset in `src/services/stt.ts` to map Burmese SOV dictation to direct English imperative coding commands (SVO order).
- **Spoken Naming Conventions Support**: Add explicit instructions for mapping spoken variable naming terms (`camelCase`, `snake_case`, `PascalCase`, `kebab-case`) to formatted code identifiers.
- **Strict Formatting & Zero Preamble**: Enforce strict zero-conversational preamble output without intro phrases ("Here is the instruction:"), markdown code block wrapping, or trailing full stops in terminal/CLI environments.

## Capabilities

### New Capabilities

- `code-dictation-prompt`: High-precision Burmese-to-English spoken code prompt translation with imperative reordering and identifier formatting.

### Modified Capabilities

None.

## Impact

- `src/services/stt.ts`: `getPresetPromptInstructions("code_comment")` updated with hardened prompt instructions.
- `src/__tests__/services/menu-bar-gui.test.ts`: Unit test assertions updated to verify hardened prompt instruction rules.
