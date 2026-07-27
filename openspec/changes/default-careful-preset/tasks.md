## 1. Implementation

- [ ] 1.1 Update `DEFAULT_DICTATION_PRESET` to `"careful"` in `src/services/config.ts`
- [ ] 1.2 Update preset dropdown option defaults in `src/renderer/index.html`
- [ ] 1.3 Run test suite (`bun test`) to verify 100% pass across all tests

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.2.0`
