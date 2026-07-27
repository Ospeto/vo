# Design: Multi-Key Round-Robin Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 MULTI-KEY ROUND-ROBIN ROTATION ARCHITECTURE                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ UI / Config Input: "KEY_A, KEY_B, KEY_C" ]                               │
│  └── Parse into Array: ["KEY_A", "KEY_B", "KEY_C"]                          │
│                                                                             │
│  [ Gemini Client Manager: src/services/gemini-client.ts ]                   │
│  ├── keyIndex = (keyIndex + 1) % keys.length                                │
│  └── Rotate GoogleGenAI instance for each request                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
