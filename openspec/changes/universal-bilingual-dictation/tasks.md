## 1. STT Service Prompt Integration

- [x] 1.1 Implement Global Natural Bilingual Directives in `getPresetPromptInstructions` in `src/services/stt.ts`
- [x] 1.2 Update preset prompt tests in `src/__tests__/services/menu-bar-gui.test.ts`
- [x] 1.3 Run test suite (`bun test`) to ensure 229/229 tests pass

## 2. Re-build & Distribution

- [x] 2.1 Build production bundle (`bun run build`)
- [x] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [x] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.0.0`
