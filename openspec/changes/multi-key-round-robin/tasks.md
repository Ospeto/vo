## 1. Implementation

- [ ] 1.1 Update `src/services/gemini-client.ts` to parse multi-key input and rotate clients in Round-Robin order
- [ ] 1.2 Update `src/services/config.ts` helper to extract array of API keys
- [ ] 1.3 Update settings UI input placeholder and label in `src/renderer/index.html`
- [ ] 1.4 Add unit tests for multi-key rotation in `src/__tests__/services/gemini-client.test.ts`
- [ ] 1.5 Run test suite (`bun test`) to verify 100% pass across all tests

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.2.0`
