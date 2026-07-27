# Tasks: Dual Hotkey Voice Architecture

## 1. Config & Hotkey Service Updates

- [ ] 1.1 Add `editKey` to `PiVoiceConfig` schema and defaults in `src/services/config.ts`
- [ ] 1.2 Update `HotkeyService` and `FnHook` to register both `key` and `editKey` in `src/services/hotkey-service.ts`

## 2. Main Process Mode Routing & STT Integration

- [ ] 2.1 Update `startRecordingFlow` in `src/main.ts` to accept trigger mode (`"dictate" | "edit"`)
- [ ] 2.2 Update `transcribeDetailed` call to pass `selectedText` ONLY when trigger mode is `"edit"`
- [ ] 2.3 Update HUD payload to pass `isEditMode` and `hasSelection` for purple glow rendering in `src/renderer/hud.html`

## 3. Integration & Testing

- [ ] 3.1 Write unit tests for dual hotkey config parsing and mode routing in `src/__tests__/services/dual-hotkey.test.ts`
- [ ] 3.2 Verify end-to-end full build and test suite pass with 100% success
