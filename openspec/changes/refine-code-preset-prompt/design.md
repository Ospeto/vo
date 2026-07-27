# Design: Systematic Code Dictation Prompt Architecture

## Overview
The goal of this design is to eliminate over-improvisation, unsaid assumption additions, and bloated architectural essays when developers use the `code_comment` (Code) preset.

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    REFRAINED SYSTEMATIC PROMPT ARCHITECTURE               │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  [ Developer Spoken Audio ]                                                │
│               │                                                            │
│               ▼                                                            │
│  [ getPresetPromptInstructions("code_comment") ]                           │
│  - Systematic Persona (Fidelity-First)                                     │
│  - Strict Anti-Hallucination Directives                                    │
│  - Zero Unsaid Logic Additions                                             │
│  - Concise Engineering Imperatives                                         │
│               │                                                            │
│               ▼                                                            │
│  [ Gemini 3.6 / 3.5 Multimodal API ]                                       │
│               │                                                            │
│               ▼                                                            │
│  [ Direct, Faithful Technical Specification Output ]                       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Prompt Directives Specification

```
Preset Mode: SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION.
Transcribe and translate the developer's spoken Burmese/English dictation into clean, direct, systematic English instructions for AI coding assistants.

STRICT DIRECTIVES:
1. FAITHFUL TRANSLATION: Translate spoken Burmese into clear, direct English without adding unmentioned architectural assumptions, libraries, or unsaid requirements.
2. NO IMPROVISATION OR OVER-CORRECTION: Do NOT invent unsaid state management, unsaid code blocks, or extra steps. Output ONLY what the user explicitly requested.
3. CONCISE IMPERATIVE INSTRUCTIONS: Keep the output concise, structured, and formatted as clean engineering imperatives.
4. CASING HINTS: Respect casing cues ("camel case fooBar" -> fooBar, "snake case foo_bar" -> foo_bar).
5. ZERO BURMESE SCRIPT: Output pure English text only.
```
