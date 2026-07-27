## Context

`vo` supports 4 dictation presets (`fast`, `code_comment`, `email_polish`, `burmese_written`). Users who speak Burmese but need English output (for code comments, commit messages, or Slack messages) require a dedicated `translate_en` preset.

## Goals / Non-Goals

**Goals:**
- Add `translate_en` as a supported `DictationPreset` in `config.ts`, `stt.ts`, and `index.html`.
- Single-pass audio-to-English translation in Gemini STT to maintain sub-500ms latency.
- Full test coverage for preset instruction resolution and config parsing.

**Non-Goals:**
- Multi-language translation targets (e.g. Burmese -> Japanese/Chinese).
- Offline Whisper translation.

## Decisions

### Decision 1: Single-Pass Gemini STT Translation Prompt
- **Rationale**: Combining STT and Translation into a single Gemini 3.1 Flash Lite inference call minimizes latency (~450ms) compared to a two-pass pipeline (STT -> Translate) which takes ~1400ms.

## Risks / Trade-offs

- [Risk: Mixed Burmese/English speech] → Mitigation: Explicitly instruct Gemini in `translate_en` prompt to convert all Burmese spoken audio to English while preserving existing English technical terms.
