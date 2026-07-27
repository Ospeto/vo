## 1. Implementation

- [ ] 1.1 Update `getPresetPromptInstructions` for `translate_en` and `code_comment` in `src/services/stt.ts`
- [ ] 1.2 Update `getFallbackModelChain` in `src/services/stt.ts` to include `gemini-3.6-flash` for `translate_en`
- [ ] 1.3 Update unit tests in `src/__tests__/services/stt.test.ts`
- [ ] 1.4 Run test suite (`bun test`) to verify 100% pass across all tests

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.2.0`
