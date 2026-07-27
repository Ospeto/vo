## 1. Native Target Resolution & osascript Removal

- [x] 1.1 Update `getActiveAppName()` in `src/services/stt.ts` to call native C++ `pi_paste.node` (`capture()`) directly instead of spawning `osascript`.
- [x] 1.2 Add unit tests verifying sub-2ms active application target resolution without child process execution.

## 2. OS Keychain API Key Encryption

- [x] 2.1 Integrate Electron `safeStorage` API into `loadConfig` / `saveConfig` in `src/services/config.ts`.
- [x] 2.2 Add fallback logic to gracefully store plain-text keys when `safeStorage.isEncryptionAvailable()` returns false.

## 3. Canvas Visualizer Motion Throttling

- [x] 3.1 Update `startWaveAnimationLoop()` in `src/renderer/renderer.ts` to check `smoothedAmp < 0.01` and HUD window visibility state before requesting next animation frame.
- [x] 3.2 Add resume trigger on audio level pulse to restart animation loop smoothly.

## 4. Verification & Testing

- [x] 4.1 Run full `bun test` suite to verify 100% pass status.
- [x] 4.2 Repackage `dist/mac-arm64/vo.app` with `bun run dist:dmg` and verify runtime behavior.
