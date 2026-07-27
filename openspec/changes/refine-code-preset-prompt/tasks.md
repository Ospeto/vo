## 1. Prompt Refinement in STT Service

- [x] 1.1 Update `getPresetPromptInstructions("code_comment")` in `src/services/stt.ts` with Systematic Anti-Hallucination Directives
- [x] 1.2 Update prompt assertion unit tests in `src/__tests__/services/menu-bar-gui.test.ts`
- [x] 1.3 Run full test suite (`bun test`) to ensure 226/226 tests pass

## 2. Re-build & Distribution

- [x] 2.1 Re-build production bundle (`bun run build`)
- [x] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [x] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.0.0`
