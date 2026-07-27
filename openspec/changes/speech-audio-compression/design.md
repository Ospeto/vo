# Design: 24kbps Speech Audio Compression Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 24kbps SPEECH AUDIO COMPRESSION ARCHITECTURE                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ getUserMedia Audio Constraints ]                                         │
│  └── sampleRate: 16000, channelCount: 1, noiseSuppression, echoCancellation │
│                                                                             │
│  [ MediaRecorder Opus Config ]                                              │
│  └── mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 24000          │
│                                                                             │
│  [ Network Transmission Payload ]                                           │
│  └── 11s Audio: 192 KB ➔ 32 KB (6x Reduction, -1.5s Upload Latency)         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
