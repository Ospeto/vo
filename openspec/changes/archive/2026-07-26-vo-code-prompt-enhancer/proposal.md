## Why

The current `code_comment` preset only formats dictation as simple single-line code comments (`// comment`). When developers dictate coding features or bug fixes in spoken Burmese, they need an intelligent AI Coding Prompt Enhancer that rewrites and expands their spoken intent into structured, detailed, professional English prompts tailored for AI coding assistants (e.g., Antigravity, Cursor, Claude, Copilot).

## What Changes

- Replace the basic `code_comment` system prompt in `src/services/stt.ts` with a **Systematic AI Coding Prompt Enhancer** prompt instruction.
- When `code_comment` preset is active, Gemini STT will analyze the spoken Burmese software intent, extract core requirements, infer standard engineering edge cases (retry handling, logging, state checks, type safety), and output a single-paragraph high-precision English engineering spec.
- Update unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to verify the enhanced prompt instruction string for `code_comment`.

## Capabilities

### New Capabilities

- `dictation-presets`: Enhanced `code_comment` preset mode that transforms spoken Burmese coding ideas into structured English AI coding prompts.

### Modified Capabilities

- None.

## Impact

- `src/services/stt.ts`: Updated `getPresetPromptInstructions("code_comment")` to use the Systematic AI Coding Prompt Enhancer prompt.
- `src/__tests__/services/menu-bar-gui.test.ts`: Updated unit test assertions for `code_comment`.
