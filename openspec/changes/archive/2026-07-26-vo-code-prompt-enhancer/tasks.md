## 1. System Prompt Upgrade

- [x] 1.1 Update `getPresetPromptInstructions("code_comment")` in `src/services/stt.ts` to instruct Gemini STT to rewrite and expand spoken Burmese coding intent into a detailed, structured English AI coding prompt.

## 2. Testing & Verification

- [x] 2.1 Update unit tests in `src/__tests__/services/menu-bar-gui.test.ts` to verify the upgraded `code_comment` prompt instruction.
- [x] 2.2 Execute full test suite via `bun test` and build production bundle via `bun run build`.
