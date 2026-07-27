# Design: Universal Natural Bilingual Dictation Engine

## Overview
Developers naturally speak in a blend of Burmese natural language and English technical terms. This design configures `getPresetPromptInstructions` to inject natural bilingual dictation directives into `fast`, `auto`, `burmese_written`, and `email_polish` presets while isolating `code_comment` and `translate_en` for pure English outputs.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 BILINGUAL DICTATION SYSTEM ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Developer Spoken Audio: Mixed Burmese + English Technical Jargon ]       │
│                                │                                            │
│                                ▼                                            │
│                 [ Preset Prompt Routing Engine ]                            │
│                                │                                            │
│          ┌─────────────────────┴─────────────────────┐                      │
│          ▼                                           ▼                      │
│  [ Pure English Presets ]                 [ Natural Bilingual Presets ]    │
│  - code_comment                           - fast                            │
│  - translate_en                           - auto                            │
│                                           - burmese_written                 │
│  Output: Pure English Specs               - email_polish                    │
│  (Zero Burmese script)                    Output: Natural Mixed Dictation   │
│                                           (Burmese script + English terms)  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prompt Instruction Specification

```typescript
const GLOBAL_BILINGUAL_DIRECTIVE = `
GLOBAL BILINGUAL DICTATION DIRECTIVES:
The speaker naturally mixes spoken Burmese natural prose with English technical terms, acronyms, code identifiers, and CLI commands.
1. PRESERVE NATURAL BILINGUAL FLOW: Transcribe spoken Burmese text in clean Burmese script (မြန်မာစာ) and spoken English technical terms/commands in exact English.
2. DO NOT FORCE FULL TRANSLATION: Do NOT forcibly translate spoken Burmese words to English, and do NOT forcibly translate English technical terms to Burmese.
3. SPOKEN IDENTIFIERS: Convert spoken code cues ("camel case userId", "snake case created_at") into exact code symbols.
`.trim();
```
