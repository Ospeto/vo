# Design: Fallback Paid API Key Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 FALLBACK PAID API KEY ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Primary Round-Robin Keys ] ────► Attempt Generation                      │
│                                           │                                 │
│                                    (If 429 / Quota Error)                   │
│                                           ▼                                 │
│  [ Emergency Paid Fallback Key ] ──► Execute Backup Request                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
