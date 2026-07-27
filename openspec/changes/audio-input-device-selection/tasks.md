## 1. Implementation

- [ ] 1.1 Add `audioDeviceId` to `PiVoiceConfig` and schema in `src/services/config.ts`
- [ ] 1.2 Update `setupAudioPipeline` to apply `audioDeviceId` constraint in `src/renderer/capture.ts`
- [ ] 1.3 Add Microphone Device Selector UI in `src/renderer/index.html` and `src/renderer/renderer.ts`
- [ ] 1.4 Run test suite (`bun test`) to verify 100% pass across all 233 unit tests

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.2.0`
