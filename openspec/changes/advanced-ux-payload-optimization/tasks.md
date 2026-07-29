## 1. Core Optimizations

- [ ] 1.1 Add advanced Burmese & English hesitation stripping in `sanitizeTranscribedText` in `src/services/stt.ts`
- [ ] 1.2 Implement persisted Toggle Mode and Hold Mode handling in `src/main.ts`
- [ ] 1.3 Add configurable transcription delay and auto-endpointing settings to config, capture, and renderer settings UI
- [ ] 1.4 Add hesitation sanitizer and transcription endpointing unit tests
- [ ] 1.5 Run test suite (`bun test`) to ensure all tests pass

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.0.0`
