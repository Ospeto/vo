## 1. Core Audio Compression Implementation

- [ ] 1.1 Update `getUserMedia` constraints to 16kHz mono in `src/renderer/capture.ts`
- [ ] 1.2 Set `audioBitsPerSecond: 24000` on `MediaRecorder` in `src/renderer/capture.ts`
- [ ] 1.3 Run test suite (`bun test`) to ensure all 233 tests pass

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.1.0`
