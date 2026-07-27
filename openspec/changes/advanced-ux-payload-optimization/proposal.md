# Proposal: Advanced UX & Audio Payload Optimizations

## Why
To deliver an uncompromised, world-class dictation experience, `vo.app` needs:
1. **Compressed Audio Payload**: Reducing audio byte size for faster uploads on variable networks.
2. **Hybrid Tap & Hold Dictation**: Automatically detecting whether the user tapped or held the global hotkey (`Ctrl+Cmd+Option+V`) without requiring manual settings toggles.
3. **Advanced Hesitation Sanitizer**: Stripping spoken Burmese/English hesitation fillers (`, nd-sat`, `အာ`, `အင်း`, `ဒီဥစ္စာ`, `like,`, `you know,`).
4. **Visual Floating HUD Status**: Enhancing active dictation state visibility via renderer HUD updates and tray badge indicators.

## Scope
- Update `sanitizeTranscribedText` in `src/services/stt.ts` with comprehensive Burmese & English hesitation filler stripping.
- Implement Hybrid Tap-to-Talk and Hold-to-Talk auto-detection in `src/services/hotkey-service.ts` & `src/main.ts`.
- Compress recorded audio buffers in `src/main.ts` for minimal network payload size.
- Update renderer status UI in `src/renderer/renderer.ts` to display live visual status indicators.
- Add unit tests in `src/__tests__/services/stt.test.ts` and `src/__tests__/services/hotkey-service.test.ts`.

## Capabilities
### Modified Capabilities
- `advanced-ux-payload-optimization`: Add hesitation stripping, hybrid tap/hold key detection, compressed audio payload handling, and status capsule indicators.
