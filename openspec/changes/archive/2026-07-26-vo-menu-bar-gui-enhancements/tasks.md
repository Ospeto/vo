## 1. Schema, Geometry & Configuration Persistence

- [x] 1.1 Update `src/services/config.ts` to support `dictationPreset`, `audioChimesEnabled`, and `customVocabulary` array.
- [x] 1.2 Implement ring buffer storage and clear history functionality for recent dictations in `~/.pi-voice/history.json`.
- [x] 1.3 Adjust popover window height in `src/main.ts` and `src/renderer/style.css` to 340px to prevent UI clipping.

## 2. STT Engine Integration

- [x] 2.1 Update `src/services/stt.ts` to accept active preset choice and append dynamic system prompt formatting instructions (`Code Comment`, `Email Polish`, `Burmese Written`).
- [x] 2.2 Inject sanitized custom vocabulary terms into Gemini STT context payload.

## 3. Popover UI & Audio Feedback

- [x] 3.1 Update `src/renderer/index.html` with preset selector, recent history panel with copy/clear buttons, audio chime toggle, and vocabulary editor.
- [x] 3.2 Implement Web Audio API dual sine wave synth chimes in `src/renderer/renderer.ts` with explicit `audioContext.resume()` check.
- [x] 3.3 Style new popover sections in `src/renderer/style.css` maintaining native Apple `0.42` alpha translucency, 16px corner radius, and 1px dividers.

## 4. Verification & Testing

- [x] 4.1 Write unit tests for preset prompt selection, history ring buffer bounds, and custom vocabulary sanitization in `src/__tests__/services/menu-bar-gui.test.ts`.
- [x] 4.2 Execute full test suite via `bun test` and build production bundle via `bun run build`.
