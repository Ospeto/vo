## Context

The `code_comment` dictation preset in `src/services/stt.ts` transforms spoken Burmese technical dictation into English prompts for Cursor and Antigravity AI coding tools. Currently, spoken Burmese SOV dictation and spoken naming conventions (`camelCase`, `snake_case`) can sometimes retain conversational hesitation or improper ordering.

## Goals / Non-Goals

**Goals:**
- Harden `getPresetPromptInstructions("code_comment")` in `src/services/stt.ts` with explicit Burmese SOV ➔ English SVO imperative transformation rules.
- Add rules for formatting spoken variable names (`camelCase`, `snake_case`, `PascalCase`, `kebab-case`, `UPPER_CASE`).
- Enforce strict zero conversational preamble output.
- Update unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to verify the hardened prompt rules.

**Non-Goals:**
- Implementing a separate raw code execution engine.
- Modifying non-code presets (`burmese_written`, `email_polish`).

## Decisions

- **Hardened Prompt Rules**: Update `code_comment` instruction to explicitly mandate:
  1. Imperative SVO order (Action ➔ Target ➔ Condition).
  2. Naming convention translation (spoken "camel case user id" ➔ `userId`).
  3. Clean text output without intros or code fences.

## Risks / Trade-offs

- [Risk] Overly strict prompt might omit nuanced edge case context → Mitigation: Explicitly rule "PRECISION WITHOUT TRUNCATION" to preserve all stated conditions and error handlers.
