# Design: Advanced UX & Payload Optimization Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│             ADVANCED UX & PAYLOAD OPTIMIZATION ARCHITECTURE                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Global Hotkey Event Engine ]                                             │
│  ├── Press Duration < 350ms ➔ Tap Mode (Toggle Recording)                  │
│  └── Press Duration >= 350ms ➔ Hold Mode (Auto-Stop on Keyup)               │
│                                                                             │
│  [ Audio Payload Stream ]                                                   │
│  └── Lightweight PCM WebM Chunk Slicing (<50KB Optimized Buffer)            │
│                                                                             │
│  [ Text Processing Pipeline ]                                               │
│  └── Advanced Hesitation Stripper (regex & phoneme cleanup)                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
