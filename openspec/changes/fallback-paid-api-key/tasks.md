## 1. Implementation

- [ ] 1.1 Add `geminiFallbackApiKey` to `PiVoiceConfig` and Zod schema in `src/services/config.ts`
- [ ] 1.2 Implement `getGeminiFallbackClient` and fallback execution in `src/services/gemini-client.ts`
- [ ] 1.3 Add Fallback API Key input UI in `src/renderer/index.html` and `src/renderer/renderer.ts`
- [ ] 1.4 Add unit tests for fallback API key failover in `src/__tests__/services/gemini-client.test.ts`
- [ ] 1.5 Run test suite (`bun test`) to verify 100% pass across all tests

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.2.0`
