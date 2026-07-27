## 1. Prompt Instructions & Service Hardening

- [x] 1.1 Update `getPresetPromptInstructions("code_comment")` in `src/services/stt.ts` with imperative SVO ordering and identifier naming rules.
- [x] 1.2 Update unit test assertions in `src/__tests__/services/menu-bar-gui.test.ts` to test hardened prompt instructions.

## 2. Verification & Build

- [x] 2.1 Run full test suite via `bun test` and ensure 100% pass rate.
- [x] 2.2 Rebuild production bundle via `bun run build` and restart daemon.
- [x] 2.3 Archive change proposal via `openspec archive vo-code-comment-prompt-hardening --yes`.
