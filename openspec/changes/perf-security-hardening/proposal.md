## Why

The current `pi-voice` implementation experiences target application detection latency from spawning AppleScript `osascript` subprocesses, idle CPU/GPU consumption from unthrottled spectrum visualizer canvas rendering, plain-text API key storage in `config.json`, and raw IPC error string leaks. 
Hardening these performance and security boundaries guarantees sub-2ms active window context resolution, lower idle resource usage on Apple Silicon, OS Keychain credential encryption, and sanitized IPC error delivery.

## What Changes

- **Target App Capture Optimization**: Replace `osascript` subprocess calls in `src/services/stt.ts` with direct calls to `pi_paste.node` C++ addon (`capture()`), resolving active application titles in under 2ms.
- **Spectrum Waveform Idle Throttling**: Pause `requestAnimationFrame` loop in `src/renderer/renderer.ts` when audio gain level is idle (<0.01) or HUD window is non-visible.
- **Keychain API Key Encryption**: Integrate Electron `safeStorage` API to encrypt Gemini primary and fallback API keys in OS Keychain, leaving only encrypted payloads or references in `config.json`.
- **IPC Error Delivery Sanitization**: Sanitize stack traces and raw secret keys from IPC handler exception responses before sending to renderer.

## Capabilities

### New Capabilities
- `safe-storage-keychain`: Encrypt and decrypt Gemini API keys using Electron `safeStorage` (macOS Keychain).
- `native-app-target-detection`: Direct native C++ target application resolution eliminating `osascript` subprocess spawns.
- `idle-canvas-throttling`: Automatically pause canvas visualizer rendering loops when input gain is silent or HUD is hidden.

### Modified Capabilities
- None.

## Impact

- `src/services/stt.ts`: Eliminates `osascript` exec calls and updates `getActiveAppName()` to leverage native C++ addon.
- `src/renderer/renderer.ts`: Adds visibility and audio amplitude guards to `requestAnimationFrame` render loop.
- `src/services/config.ts`: Updates `loadConfig` / `saveConfig` to encrypt API keys via `safeStorage` when available.
- `src/main.ts`: Wraps IPC handler exception outputs in error sanitizer.
