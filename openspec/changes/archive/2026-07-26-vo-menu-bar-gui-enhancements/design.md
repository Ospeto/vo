## Context

The `vo` application runs an Electron menu bar popover window (`src/renderer/`) backed by a background daemon (`src/main.ts`). This design document specifies how dictation presets, recent history storage, native audio feedback, and custom vocabulary management will be seamlessly integrated into the popover without compromising macOS translucency or stealing active keyboard focus.

## Goals / Non-Goals

**Goals:**
- Add dynamic STT prompt preset selection (`Fast Transcribe`, `Code Comment`, `Email Polish`, `Burmese Written`) persisted in config.
- Maintain an in-memory & persisted recent dictation history ring buffer (last 5 entries) with instant clipboard copy.
- Implement lightweight Web Audio API synth sound cues for start/stop dictation toggled via popover UI.
- Provide a custom vocabulary dictionary editor that passes context terms to Gemini API payloads.

**Non-Goals:**
- Complex cloud sync for dictation history across multiple devices.
- Full local LLM execution for text polishing.

## Decisions

1. **Preset System Prompt Engineering**:
   - *Decision*: Map selected preset key in `src/services/config.ts` and append corresponding system instructions in `src/services/stt.ts`.
   - *Alternatives Considered*: Hardcoding prompts in renderer vs server-side prompt fetch. Local mapping ensures offline reliability.

2. **Ring Buffer History Persistence**:
   - *Decision*: Store maximum 5 recent dictation entries in `~/.pi-voice/history.json` and sync updates to renderer via IPC state snapshots.
   - *Alternatives Considered*: Storing in SQLite vs Config JSON. Ring buffer in dedicated history file keeps config lightweight.

3. **Web Audio Synth Chimes**:
   - *Decision*: Synthesize soft native-sounding dual sine wave chimes via `AudioContext` in `renderer.ts` to avoid external sound file asset dependencies.
   - *Alternatives Considered*: Bundling WAV/MP3 files vs macOS `afplay`. Web Audio synthesis is zero-byte footprint and instant.

## Risks / Trade-offs

- **[Risk] High Memory Usage from Long Transcripts in Popover**:  
  *Mitigation*: Truncate displayed transcript text in history items to 60 characters with full string copyable via clipboard button.
- **[Risk] Prompt Pollution from Custom Terms**:  
  *Mitigation*: Sanitize custom terms array to max 50 items and cap single term length to 40 characters.
