## 1. Implementation

- [ ] 1.1 Add `appPresetMappings` to `PiVoiceConfig` and Zod schema in `src/services/config.ts`
- [ ] 1.2 Update `resolveEffectivePreset` to respect `appPresetMappings` in `src/services/stt.ts`
- [ ] 1.3 Add collapsible Smart Auto App Rules drawer UI in `src/renderer/index.html`
- [ ] 1.4 Wire `renderAppRules`, add rule, and delete rule handlers in `src/renderer/renderer.ts`
- [ ] 1.5 Add unit tests for custom app mappings in `src/__tests__/services/stt.test.ts`
- [ ] 1.6 Run test suite (`bun test`) to verify 100% pass across all tests

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.2.0`
