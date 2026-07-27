# Design: High-Performance Latency Architecture (-600ms Speedup)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 HIGH-PERFORMANCE LOW-LATENCY ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Background Event Loops ]                                                 │
│  ├── Background Async Symbol Scanner (Cache updated every 5s / on change)  │
│  ├── Asynchronous App Switch Observer (frontmostApp cached instantly)       │
│  └── HTTP/2 Ping Keep-Alive Daemon (Sockets pre-warmed & ready)             │
│                                                                             │
│  [ Immediate Dictation Trigger ]                                            │
│  └── Hotkey Stop Event ➔ Reads In-Memory Caches (<2ms) ➔ Submits to Gemini   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Optimization Strategy
1. **Async Background Symbol Scanner (`src/services/symbol-scanner.ts`)**:
   Return in-memory cached symbol trees immediately when `scanWorkspaceSymbols` is called, scheduling background refreshes asynchronously without blocking transcription.
2. **Fast Cached App Observer (`src/services/stt.ts`)**:
   Cache frontmost application metadata for 3000ms and run non-blocking AppleScript updates in background.
3. **HTTP/2 Session Warm-Keeping (`src/services/gemini-client.ts`)**:
   Pre-warm and maintain persistent HTTP/2 connection pooling with Keep-Alive headers.
