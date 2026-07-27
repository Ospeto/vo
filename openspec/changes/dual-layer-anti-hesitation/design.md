# Design: Dual-Layer Anti-Hesitation Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 DUAL-LAYER ANTI-HESITATION ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Layer 1: Upstream STT Prevention ]                                       │
│  └── GLOBAL_BILINGUAL_DIRECTIVE: Explicit vocalization purge instruction    │
│                                                                             │
│  [ Layer 2: Downstream Morphological Regex Sanitizer ]                      │
│  └── Standalone phonemes: (အာ|ဟာ|အင်|အင်း|အာ့) followed by punctuation/spaces│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
