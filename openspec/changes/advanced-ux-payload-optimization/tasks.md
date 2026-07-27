## 1. Core Optimizations

- [ ] 1.1 Add advanced Burmese & English hesitation stripping in `sanitizeTranscribedText` in `src/services/stt.ts`
- [ ] 1.2 Implement Hybrid Tap & Hold auto-detection logic in `src/main.ts` & `src/services/hotkey-service.ts`
- [ ] 1.3 Add hesitation sanitizer unit tests in `src/__tests__/services/stt.test.ts`
- [ ] 1.4 Run test suite (`bun test`) to ensure all tests pass

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.0.0`
