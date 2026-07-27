## 1. Codebase Latency Optimizations

- [x] 1.1 Optimize `scanWorkspaceSymbols` in `src/services/symbol-scanner.ts` with non-blocking async background refresh
- [x] 1.2 Optimize `getActiveAppName` in `src/services/stt.ts` with cached non-blocking lookup (3000ms TTL)
- [x] 1.3 Enhance `getGeminiClient` in `src/services/gemini-client.ts` with persistent HTTP/2 Keep-Alive socket pooling
- [x] 1.4 Run test suite (`bun test`) to ensure all 230 tests pass

## 2. Re-build & Distribution

- [x] 2.1 Build production bundle (`bun run build`)
- [x] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [x] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.0.0`
