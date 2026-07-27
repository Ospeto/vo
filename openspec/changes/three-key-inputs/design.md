# Design: 3 Dedicated Primary API Key Fields Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 3 DEDICATED API KEY FIELDS ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ UI Inputs: Key 1, Key 2, Key 3 ]                                         │
│  └── On Save ➔ Join non-empty keys with "," into geminiApiKey               │
│                                                                             │
│  [ Config Load: geminiApiKey ]                                              │
│  └── On Load ➔ Split by "," and populate Key 1, Key 2, Key 3 fields          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
