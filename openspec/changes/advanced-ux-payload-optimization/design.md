# Design: Advanced UX & Payload Optimization Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│             ADVANCED UX & PAYLOAD OPTIMIZATION ARCHITECTURE                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Global Hotkey Event Engine ]                                             │
│  ├── Toggle Mode ➔ Tap once to start, tap again to stop                    │
│  └── Hold Mode ➔ Release the hotkey to stop                                │
│                                                                             │
│  [ Audio Payload Stream ]                                                   │
│  └── Lightweight PCM WebM Chunk Slicing (<50KB Optimized Buffer)            │
│                                                                             │
│  [ Text Processing Pipeline ]                                               │
│  └── Advanced Hesitation Stripper (regex & phoneme cleanup)                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
