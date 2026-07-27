# Design: Persistent Cost Ledger Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 PERSISTENT COST LEDGER ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Persistent Location: ~/.config/pi-voice/ ]                               │
│  ├── history.json           ➔ Up to 500 recent dictations                   │
│  └── cost-ledger.json       ➔ Permanent cumulative ledger                   │
│      ├── lifetimeCost: 0.00412                                              │
│      ├── monthlyCosts: { "2026-07": 0.00412 }                               │
│      └── totalDictations: 42                                                │
│                                                                             │
│  [ Deduplication Guard ]                                                    │
│  └── Blocks duplicate entries (same text + cost within 3000ms)              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
