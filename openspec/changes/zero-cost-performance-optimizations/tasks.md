## 1. Implementation

- [ ] 1.1 Add pre-warmed audio stream standby & RMS silence trimming in `src/renderer/capture.ts`
- [ ] 1.2 Optimize history list rendering with `DocumentFragment` batch paint in `src/renderer/renderer.ts`
- [ ] 1.3 Add deep-idle memory management in `src/main.ts`
- [ ] 1.4 Run test suite (`bun test`) to verify 100% pass across all 233 unit tests

## 2. Re-build & Distribution

- [ ] 2.1 Build production bundle (`bun run build`)
- [ ] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [ ] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.1.0`
