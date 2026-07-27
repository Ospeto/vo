# Teamwork Project Prompt — Revised Canonical Specifications

> Status: Saved in project plan directory
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

Implement a native macOS Menu Bar (Tray) GUI interface for `pi-voice` adhering to a two-window architecture (hidden capture window + 360x480 popover window), canonical 8-state lifecycle state machine with sequence IDs, HotkeyService single ownership, atomic configuration persistence, Web Audio DSP gain/metering graph, IPC sender security validation, and macOS native SF Pro translucency UI design.

Working directory: /Users/macbookair/pi_voice_gemini/pi-voice
Integrity mode: development

## Requirements

### R1. Two-Window Isolation Architecture
- Separate audio capture into a hidden `BrowserWindow` (`MediaStream`, `GainNode`, `DynamicsCompressor`, `MediaRecorder`).
- Implement popover UI in a separate `360px × 480px` frameless popover `BrowserWindow` with native macOS `vibrancy: "under-window"`.
- Main process remains authoritative for state, configuration, hotkeys, model selection, and safe paste.
- Toggling, opening, closing, or blurring popover window must never interrupt active audio recording.

### R2. Canonical State Machine & IPC Lifecycle
- Enforce state lifecycle: `idle` → `starting` → `recording` → `stopping` → `transcribing` → `thinking` → `speaking` → `error`.
- Use monotonic `sequenceId` in `STATE_SNAPSHOT` and `STATE_CHANGED` IPC payloads for recording commands and acknowledgements.
- Handle stale acknowledgements and recover automatically if capture renderer process terminates.

### R3. Single Hotkey Ownership & HotkeyService
- Make `FnHook` and `HotkeyService` the sole owners of hotkeys; disable duplicate fixed `globalShortcut` calls.
- Implement `HotkeyService` methods: `start(binding)`, `replace(binding)`, `stop()`.
- Replacement algorithm: 1. Validate shortcut (reject reserved keys like `Cmd+Q`), 2. Stop old registration, 3. Register new binding, 4. Roll back on failure, 5. Persist to `.pi/pi-voice.json` only after successful registration.

### R4. Atomic Configuration Persistence
- Standardize config fields: `geminiModel: "gemini-3.1-flash-lite" | "gemini-2.5-flash"`, `inputGain: number` (clamped `[0.0, 2.0]`).
- Implement `loadConfig(cwd)` and `updateConfig(cwd, patch)`.
- Use Zod schema validation, atomic temporary file write plus rename (`renameSync`), serialized updates, preservation of unknown JSON keys, and rollback on error.

### R5. Model Selection & Fallback Chain
- Attempt user-selected Gemini model (`gemini-3.1-flash-lite` or `gemini-2.5-flash`) as the first API request.
- Pass model explicitly through `transcribe(audioData, { provider, geminiModel })`.
- Maintain fallback order: Selected Model → Alternate Gemini Model → Tertiary Fallback Model.

### R6. Web Audio DSP Graph & RMS Metering
- Build audio pipeline: `MediaStream -> GainNode(inputGain) -> DynamicsCompressor -> MediaStreamDestination -> MediaRecorder`.
- Explicitly disable `autoGainControl` for predictable manual gain control.
- Meter post-gain, pre-compressor signal at ~20 Hz with fast attack and slower decay.

### R7. IPC Security & Sender Validation
- Use `ipcMain.handle` / `ipcRenderer.invoke` for request/response methods.
- Validate `event.sender.id` against authorized window `webContents.id`.
- Sanitize all payloads with Zod schemas; reject unknown senders, malformed data, and oversized audio payloads.
- Expose zero filesystem or shell privileges to renderer processes.

### R8. Popover Behavior & Display Geometry Math
- Configure popover: `show: false`, `frame: false`, `transparent: true`, `resizable: false`, `skipTaskbar: true`, `alwaysOnTop: true`, `vibrancy: "under-window"`.
- Hide popover on tray toggle, blur, or `Escape` key (`Escape` cancels active hotkey recorder first).
- Calculate horizontal center position under tray bounds; flip above menu bar if vertical space below is insufficient.
- Opening popover must not disrupt previously focused application window.

### R9. macOS Visual System UI & Accessibility (a11y)
- Use system UI / SF Pro font stack with native macOS translucency. Exclude neon gradients, glowing borders, or emoji icons.
- Tokens: `popoverWidth: 360px`, `popoverMinHeight: 480px`, `pagePadding: 20px`, `sectionGap: 20px`, `controlGap: 8px`, `controlHeight: 32px`, `cornerRadius: 12px`, `focusRing: 2px`.
- Enforce keyboard navigation, visible focus rings, `aria-live` announcements, min 28px–32px hit areas, and `prefers-reduced-motion`.

## Acceptance Criteria

### Architecture & Lifecycle State
- [ ] Hidden capture window handles audio recording while 360x480 popover UI runs independently.
- [ ] Closing or blurring popover window does not stop recording.
- [ ] State transitions emit `STATE_CHANGED` with incrementing `sequenceId`.

### Configuration & Model Routing
- [ ] `updateConfig()` atomically saves settings and preserves unrelated JSON keys.
- [ ] Selected Gemini model is passed to first STT API request attempt.
- [ ] `HotkeyService` validates shortcuts and rolls back seamlessly on registration failure.

### Audio Graph & Visual UI
- [ ] `GainNode` adjusts volume gain while RMS meter displays post-gain intensity at ~20 Hz.
- [ ] Popover displays native macOS SF Pro glass UI with proper a11y focus rings and labels.
- [ ] Unit tests in `src/__tests__/` verify production contracts clean end-to-end.
