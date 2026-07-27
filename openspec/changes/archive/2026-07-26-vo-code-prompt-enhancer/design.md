## Context

Developers dictating casual Burmese technical ideas need their speech translated into clear, actionable, structured English software engineering prompts suitable for AI agents (Cursor, Antigravity, Claude, ChatGPT).

## Goals / Non-Goals

**Goals:**
- Replace the legacy `// comment` prompt in `code_comment` preset with a **Systematic AI Coding Prompt Enhancer** prompt instruction.
- Instruct Gemini STT to expand spoken Burmese technical intent into precise, detailed, single-paragraph English prompt specs.
- Maintain sub-500ms single-pass STT latency.

**Non-Goals:**
- Generating full source code inside STT (the output is a prompt for an AI agent, not the code implementation itself).

## Decisions

### Decision 1: Single-Paragraph High-Precision Spec Style
- **Rationale**: Outputting a single-paragraph concise engineering spec prevents unwanted multi-line markdown headers when pasting directly into Cursor/Agent chat input boxes, while providing maximum context to AI coding models.

## Risks / Trade-offs

- [Risk: Over-expanding simple code comments] → Mitigation: Instruct Gemini STT to preserve concise intent for short inputs while expanding technical intent for feature descriptions.
