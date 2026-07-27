## Context

In `pi-voice`, active target application resolution currently relies on spawning an `osascript` shell process when active application cache expires (>3000ms). Furthermore, API keys are saved as unencrypted strings in `config.json`, and the audio spectrum canvas visualizer runs continuous `requestAnimationFrame` render loops even during silence or when HUD is concealed.

## Goals / Non-Goals

**Goals:**
- Upgrade `getActiveAppName()` in `stt.ts` to call native C++ `pi_paste.node` (`capture()`), resolving active application titles in under 2ms with zero shell subprocesses.
- Integrate Electron `safeStorage` API to encrypt API keys on disk.
- Implement an amplitude and visibility guard in `renderer.ts` to pause spectrum canvas visualizer animation when silent or hidden.
- Sanitize IPC handler exception responses.

**Non-Goals:**
- Replacing `uIOhook` with a different hotkey daemon.
- Refactoring Gemini SDK API interfaces.

## Decisions

### Decision 1: Direct C++ Native Addon Target Application Querying
- **Choice:** Call `loadNativePasteAddon()` / `capture()` directly inside `getActiveAppName()` instead of executing `osascript`.
- **Rationale:** `pi_paste.node` leverages `AXUIElement` native Accessibility API, eliminating `osascript` process creation overhead.

### Decision 2: Electron safeStorage API Key Protection
- **Choice:** Use `safeStorage.isEncryptionAvailable()` to encrypt `geminiApiKey` and `geminiFallbackApiKey` into base64 ciphertext buffers when saving to `config.json`.
- **Rationale:** Leverages macOS Keychain for hardware-backed key encryption without adding third-party native C++ node dependencies.

### Decision 3: Canvas Visualizer Motion Throttling
- **Choice:** Check `smoothedAmp < 0.01` and HUD visibility state in `startWaveAnimationLoop()`; cancel `animationFrameId` when idle and resume on audio level pulse.
- **Rationale:** Saves GPU/CPU cycles on Apple Silicon during background listening.

## Risks / Trade-offs

- **[Risk]** `safeStorage` encryption is tied to the macOS user keychain context.
  - **Mitigation:** Fall back gracefully to plain-text string storage if `safeStorage.isEncryptionAvailable()` returns `false` (e.g. headless CI environments).
- **[Risk]** `pi_paste.node` addon may fail to load in non-packaged dev environments.
  - **Mitigation:** Retain lightweight internal fallback if addon is unavailable.
