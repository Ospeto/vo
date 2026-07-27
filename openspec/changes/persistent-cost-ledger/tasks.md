## 1. Implementation

- [x] 1.1 Update `DEFAULT_DIR` in `src/services/history-service.ts` to `~/.config/pi-voice/`
- [x] 1.2 Implement `cost-ledger.json` cumulative persistence engine in `src/services/history-service.ts`
- [x] 1.3 Add 3000ms deduplication guard in `addHistoryEntry` in `src/services/history-service.ts`
- [x] 1.4 Update unit tests in `src/__tests__/services/history-service.test.ts`
- [x] 1.5 Run test suite (`bun test`) to verify 100% pass

## 2. Re-build & Distribution

- [x] 2.1 Build production bundle (`bun run build`)
- [x] 2.2 Re-package macOS Desktop App (`bun run dist:dmg`)
- [x] 2.3 Deploy updated `/Applications/vo.app` and commit to Git `v1.1.0`
