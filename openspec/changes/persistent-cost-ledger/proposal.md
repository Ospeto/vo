# Proposal: Persistent Cost Ledger & Deduplication Engine

## Why
Currently, dictation history and cost data are stored in a path that can be reset or lost upon app reinstalls or updates. Furthermore, when history items are pruned (beyond 200 items), historical cost totals get lost, and rapid duplicate dictation events can double-count costs.

Implementing a dedicated `Persistent Cost Ledger` in `~/.config/pi-voice/cost-ledger.json` alongside `~/.config/pi-voice/history.json` with a 3000ms deduplication guard ensures 100% data persistence across app updates, accurate cumulative monthly/lifetime totals, and zero duplicate cost metering.

## Scope
- Migrate `history.json` path to `~/.config/pi-voice/history.json` in `src/services/history-service.ts`.
- Create `cost-ledger.json` in `~/.config/pi-voice/cost-ledger.json` to store permanent cumulative monthly & lifetime totals independently of history item pruning.
- Add a 3000ms deduplication guard in `addHistoryEntry` to prevent duplicate cost entries.
- Add unit tests in `src/__tests__/services/history-service.test.ts` to verify data persistence, deduplication, and monthly cost aggregation.

## Capabilities
### Modified Capabilities
- `persistent-cost-ledger`: Store history and cost ledger permanently in `~/.config/pi-voice/`, aggregate cumulative lifetime costs, and enforce 3000ms deduplication.
