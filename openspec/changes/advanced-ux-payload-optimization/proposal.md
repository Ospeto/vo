# Proposal: Advanced UX & Audio Payload Optimizations

## Why
To deliver an uncompromised, world-class dictation experience, `vo.app` needs:
1. **Compressed Audio Payload**: Reducing audio byte size for faster uploads on variable networks.
2. **Configurable Tap & Hold Dictation**: Supporting toggle and hold behavior for the global hotkey (`Ctrl+Cmd+Option+V`) through the persisted dictation mode setting, with configurable silence endpointing.
3. **Advanced Hesitation Sanitizer**: Stripping spoken Burmese/English hesitation fillers (`, nd-sat`, `အာ`, `အင်း`, `ဒီဥစ္စာ`, `like,`, `you know,`).
4. **Visual Floating HUD Status**: Enhancing active dictation state visibility via renderer HUD updates and tray badge indicators.

## Scope
- Update `sanitizeTranscribedText` in `src/services/stt.ts` with comprehensive Burmese & English hesitation filler stripping.
- Implement persisted Toggle Mode and Hold Mode handling in `src/main.ts`.
- Add configurable transcription delay and auto-endpointing settings to the capture flow and settings UI.
- Compress recorded audio buffers in `src/main.ts` for minimal network payload size.
- Update renderer status UI in `src/renderer/renderer.ts` to display live visual status indicators.
- Add unit tests in `src/__tests__/services/stt.test.ts` and `src/__tests__/services/hotkey-service.test.ts`.

## Capabilities
### Modified Capabilities
- `advanced-ux-payload-optimization`: Add hesitation stripping, hybrid tap/hold key detection, compressed audio payload handling, and status capsule indicators.
