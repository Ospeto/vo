# Design: Careful English Translation Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 CAREFUL ENGLISH TRANSLATION ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Presets: translate_en & code_comment ]                                   │
│  └── Inject Careful Deep Proofreading System Directives                      │
│                                                                             │
│  [ Fallback Model Chain ]                                                   │
│  └── Include gemini-3.6-flash reasoning model for translate_en              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
