## 1. Implementation

- [ ] 1.1 Add `"careful"` to `DictationPreset` union type and Zod schema in `src/services/config.ts`
- [ ] 1.2 Add `careful` prompt directive and `gemini-3.6-flash` model mapping in `src/services/stt.ts`
- [ ] 1.3 Add `"careful"` option to UI preset dropdowns in `src/renderer/index.html`
- [ ] 1.4 Add unit tests for `careful` preset in `src/__tests__/services/stt.test.ts`
- [ ] 1.5 Run test suite (`bun test`) to verify 100% pass across all tests

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.2.0`
