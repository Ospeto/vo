## 1. Implementation

- [x] 1.1 Add `IPC.TEST_API_KEY` to `src/shared/types.ts` and handle it in `src/main.ts`.
- [x] 1.2 Update `#settingsModal` in `src/renderer/index.html` and `src/renderer/renderer.ts` with "Test Key" button and status badge.
- [x] 1.3 Add spoken bullet point macro rules to `sanitizeTranscribedText` in `src/services/stt.ts`.

## 2. Verification & Build

- [x] 2.1 Add unit tests for API key validation and spoken bullet macros and run `bun test`.
- [x] 2.2 Rebuild production bundle via `bun run build`, restart daemon, and repackage DMG via `bun run dist:dmg`.
- [x] 2.3 Archive change proposal via `openspec archive vo-key-validation-and-voice-macros --yes`.
