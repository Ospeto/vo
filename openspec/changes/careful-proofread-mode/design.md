# Design: Careful Proofread Mode Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 CAREFUL PROOFREAD MODE ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Dictation Preset: "careful" ]                                            │
│  └── DictationPreset = "fast" | "careful" | "code_comment" | ...            │
│                                                                             │
│  [ Model Mapping & System Prompt: src/services/stt.ts ]                     │
│  └── Model: gemini-3.6-flash                                                │
│  └── Directive: Meticulous semantic proofreader fixing homophones & grammar │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
