# Comprehensive & Canonical Implementation Plan: macOS Menu Bar GUI for pi-voice

## Executive Summary
This canonical implementation plan specifies the complete architecture, lifecycle state machine, security boundaries, UI design system, configuration persistence, test suite strategy, and rollout sequence for the **macOS Menu Bar (Tray) GUI** in `pi-voice`. 

---

## 1. Architectural Architecture & Two-Window Isolation

```mermaid
graph TD
    subgraph Main Process (Electron Main - Authoritative State)
        Main[Main Process - src/main.ts]
        StateEngine[State Machine & Sequence Tracker]
        HotkeyService[HotkeyService - Single Owner]
        ConfigService[Config Service - Atomic JSON]
        SafePaste[Safe Paste Engine - osascript / CGEvent]
    end

    subgraph Window 1: Hidden Capture Window
        CapWin[Hidden BrowserWindow]
        MicStream[MediaStream]
        GainNode[GainNode - inputGain]
        Compressor[DynamicsCompressor]
        MediaRec[MediaRecorder]
        Meter[RMS Metering @ 20Hz]
    end

    subgraph Window 2: Frameless Popover Window (360x480)
        PopWin[Popover BrowserWindow]
        PopoverUI[Native macOS SF Pro Glass UI]
        GainSlider[Gain Slider]
        ModelSelector[Gemini Model Selector]
        HotkeyRecorder[Hotkey Recorder UX]
        StateBadge[Status Badge & Aria-Live]
    end

    Tray[macOS Menu Bar Tray Icon] -->|Click Event| Main
    Main -->|Popover Geometry Math| PopWin
    
    CapWin -->|IPC: Audio Buffer / Level| Main
    PopWin -->|IPC: Settings Patch| Main
    Main -->|IPC: STATE_SNAPSHOT / STATE_CHANGED| CapWin
    Main -->|IPC: STATE_SNAPSHOT / STATE_CHANGED| PopWin
    Main -->|Update Config| ConfigService
    Main -->|Transcribe API| Gemini[Gemini STT Service]
```

### Architectural Principles:
1. **Two-Window Model**:
   - **Capture Window**: Hidden `BrowserWindow` dedicated strictly to audio stream capture, Web Audio DSP (`GainNode` + `DynamicsCompressor`), and `MediaRecorder`.
   - **Popover Window**: `360px × 480px` frameless popover window for UI interactions.
2. **Main Process Authority**:
   - Main process maintains the canonical recording state, hotkeys, config, model selection, and safe paste execution.
   - Opening, closing, reloading, or blurring the popover window **never** stops recording.

---

## 2. Canonical State Machine & IPC Lifecycle Protocol

### Valid Application States:
- `idle` → `starting` → `recording` → `stopping` → `transcribing` → `thinking` → `speaking` → `error`

### State Payload Schema:
```typescript
export interface StatePayload {
  state: AppState;
  message?: string;
  sequenceId?: number;
}
```

### Sequence ID Protocol & Crash Recovery:
- Recording commands (`START_RECORDING`, `STOP_RECORDING`) and acknowledgements require incrementing monotonic `sequenceId` numbers.
- Stale acknowledgements (matching an older `sequenceId`) are discarded immediately.
- If the hidden capture renderer crashes, main process detects `render-process-gone`, resets state to `idle`, recreates the capture window automatically, and notifies popover UI.

---

## 3. Hotkey Management & HotkeyService Contract

`FnHook` and `HotkeyService` become the **sole owners** of hotkeys. Duplicate fixed `globalShortcut` calls are removed.

### HotkeyService API Contract:
```typescript
export interface IHotkeyService {
  start(binding: KeyBinding): Promise<void>;
  replace(binding: KeyBinding): Promise<void>;
  stop(): Promise<void>;
}
```

### Atomic Hotkey Replacement Algorithm:
1. Validate candidate shortcut key combination (reject empty, modifier-only, or reserved system keys like `Cmd+Q`, `Cmd+Tab`, `Cmd+Space`).
2. Temporarily suspend existing binding.
3. Attempt registration of new binding with `globalShortcut` and `uiohook-napi`.
4. If registration fails, automatically roll back and restore previous hotkey binding.
5. Persist to configuration file **only after** successful registration.

---

## 4. Configuration Persistence & Schema

### Standardized Config Schema:
```typescript
export interface PiVoiceConfig {
  key: KeyBinding;
  keyDisplay: string;
  provider: SpeechProvider;
  geminiModel: "gemini-3.1-flash-lite" | "gemini-2.5-flash";
  inputGain: number; // Clamped [0.0, 2.0], default 1.0
}
```

### Persistence Policy:
- **Functions**: `loadConfig(cwd: string)` and `updateConfig(cwd: string, patch: Partial<PiVoiceConfig>)`.
- **Atomic File Writes**: Write payload to temporary file `.pi/pi-voice.json.tmp` followed by atomic rename (`renameSync`) to `.pi/pi-voice.json`.
- **Preservation**: Zod schema validation parses patch, preserves unrelated JSON keys, and rolls back file on write failure.
- **Scope Limit**: Unrequested properties (`theme`, `autoHidePopover`, `soundEffects`) are strictly excluded.

---

## 5. Gemini Model Routing & Fallback Chain

1. **User Selected Model First**: User selection (`gemini-3.1-flash-lite` or `gemini-2.5-flash`) is attempted as the primary API request.
2. **Explicit Parameter Passing**: STT engine calls `transcribe(audioData, { provider, geminiModel })`.
3. **Fallback Chain Order**:
   - User selected model (e.g. `gemini-2.5-flash`)
   - Alternate Gemini model (e.g. `gemini-3.1-flash-lite`)
   - Tertiary fallback (`gemini-2.5-flash-lite`)
4. **Verification**: Production unit test proves user-selected model is passed to the first API call attempt.

---

## 6. Web Audio DSP Graph & RMS Metering

### Audio Node Pipeline:
```text
MediaStream 
  → GainNode(inputGain) 
  → DynamicsCompressor 
  → MediaStreamDestination 
  → MediaRecorder
```

### Metering & Gain Rules:
- `autoGainControl` is explicitly **disabled** (`{ audio: { autoGainControl: false, echoCancellation: true, noiseSuppression: true } }`) to ensure predictable user gain control.
- Metering takes place post-`GainNode` and pre-`DynamicsCompressor`.
- Metering operates at ~20 Hz with fast attack (5ms) and slower decay (150ms).
- Edge cases tested: zero gain, silence, clipping amplitude, microphone permission denial, audio context cleanup.

---

## 7. IPC Security & Sender Validation

1. **Strict Channel Handlers**: Use `ipcMain.handle` and `ipcRenderer.invoke` exclusively for request/response methods.
2. **Sender Identity Verification**: Every `ipcMain` handler validates `event.sender.id` against authorized `captureWindow.webContents.id` or `popoverWindow.webContents.id`.
3. **Payload Sanitization**: Validate all payloads via Zod schemas. Reject unknown senders, malformed payloads, and audio payloads exceeding max byte limits (e.g. 50MB).
4. **Zero Privilege Exposure**: Renderer processes receive **no** access to `fs`, `child_process`, `clipboard`, `shell`, or direct `globalShortcut` APIs.

---

## 8. Popover Window Behavior & Geometry Math

### Window Configuration:
```typescript
const popoverWindow = new BrowserWindow({
  width: 360,
  height: 480,
  show: false,
  frame: false,
  transparent: true,
  resizable: false,
  skipTaskbar: true,
  alwaysOnTop: true,
  vibrancy: "under-window", // macOS native translucency
  visualEffectState: "active",
});
```

### Display Boundary Math & Flipping:
- Popover centers horizontally under the macOS Tray bounds.
- If vertical space below menu bar is insufficient, popover automatically flips **above** or repositions inside current screen work area.
- Hides on tray toggle, window blur, or `Escape` key.
- Pressing `Escape` while hotkey recorder is active cancels recorder first before closing popover.
- Opening popover does not disrupt previously focused application window.

---

## 9. Visual Direction & UI Tokens

Restrained, native macOS System UI matching Apple Human Interface Guidelines (HIG):
- **Font Stack**: System UI / SF Pro Text (`system-ui, -apple-system, BlinkMacSystemFont`).
- **Translucency**: Native `vibrancy: "under-window"` with subtle border `rgba(255, 255, 255, 0.15)`. No neon gradients, glowing borders, or emoji icons.

### Design Tokens:
- `popoverWidth`: `360px`
- `popoverMinHeight`: `480px`
- `pagePadding`: `20px`
- `sectionGap`: `20px`
- `controlGap`: `8px`
- `controlHeight`: `32px`
- `cornerRadius`: `12px`
- `focusRing`: `2px solid #007aff`

---

## 10. UI Layout Hierarchy

1. **Header**: Title (`pi-voice`), active status badge, subtle close button.
2. **Status Display**: Clear status indicator (`Ready`, `Listening...`, `Processing...`, `Error`).
3. **Input Section**: Input Gain slider (`0.00×` to `2.00×`), real-time RMS intensity visualizer bar.
4. **Transcription Section**: Gemini Model selector dropdown (`gemini-3.1-flash-lite` vs `gemini-2.5-flash`) with short model description text.
5. **Shortcut Section**: Current keycaps display (e.g. `⌃⌥⌘V`), `Record Shortcut` button, `Reset to Default` button.
6. **Footer**: Actionable error status messages (e.g. Microphone Permission Denied, Invalid API Key).
7. **Control State Lock**: Configuration controls are disabled while transcribing or recording.

---

## 11. Hotkey Recorder UX & Accessibility

### Recorder State Flow:
- Prompt text: "Press a shortcut…".
- Requires at least one non-modifier key. Ignores modifier-only keypresses.
- `Escape` cancels recording; `Backspace` clears assignment.
- Displays native macOS symbols (`⌃`, `⌥`, `⇧`, `⌘`).
- Previous shortcut remains active until new shortcut registration is verified.

### Accessibility (a11y):
- Full keyboard focus navigation with visible `focusRing: 2px solid #007aff`.
- `aria-live="polite"` announcements for status changes and hotkey recording actions.
- Minimum 28px–32px interactive hit areas.
- No status conveyed solely by color or animation; respects `prefers-reduced-motion`.

---

## 12. Production Test Strategy & Modules

Helper functions are placed in production modules (`src/services/`) and imported into unit tests.

### Test Coverage Checklist:
- [ ] Config load/update atomic file write & failure recovery (`src/__tests__/services/config.test.ts`).
- [ ] Unknown JSON key preservation during config updates.
- [ ] Gemini model fallback ordering and explicit parameter propagation (`src/__tests__/services/stt.test.ts`).
- [ ] Hotkey replacement, validation, and rollback on failure (`src/__tests__/services/hotkey.test.ts`).
- [ ] State machine sequence IDs & capture renderer crash recovery (`src/__tests__/services/state-machine.test.ts`).
- [ ] IPC sender validation & payload schema enforcement (`src/__tests__/services/ipc-security.test.ts`).
- [ ] Web Audio gain graph & RMS metering semantics (`src/__tests__/audio/gain-meter.test.ts`).
- [ ] Popover geometry math & multi-monitor display boundary flipping (`src/__tests__/services/popover-position.test.ts`).

---

## 13. Packaging & Asset Distribution Requirements

- **Tray Icons**: `src/assets/tray-iconTemplate.png` and `src/assets/tray-iconTemplate@2x.png` with macOS native auto-tinting (`Template` suffix).
- **Packaging Build Config**: Include renderer HTML/CSS/JS and native tray icons in `electron-builder` / `electron-vite` distribution assets.
- **Path Resolution**: Use standard `fileURLToPath` for development and packaged app asset resolution.
- **Package Inspection Gate**: Confirm no `.env`, API keys, test fixtures, or raw transcripts enter production build artifacts.

---

## 14. Scoped Rollback Procedure

- **No Destructive `git checkout .`**: Rollback must be scoped strictly to feature branch files or feature git commits (`git revert <commit-hash>`).
- Existing tests, CLI workflows, and daemon infrastructure must never be deleted or destroyed.

---

## 15. Recommended 10-Step Rollout Strategy

1. **Step 1**: Reconcile lifecycle state machine & safe-paste implementation (`src/main.ts`).
2. **Step 2**: Stabilize configuration update APIs and atomic file writes (`src/services/config.ts`).
3. **Step 3**: Implement model propagation and fallback tests (`src/services/stt.ts`).
4. **Step 4**: Implement typed IPC handlers and sender webContents validation (`src/main.ts`).
5. **Step 5**: Isolate hidden capture renderer window and implement Web Audio gain/metering (`src/renderer/capture.ts`).
6. **Step 6**: Add tray lifecycle and popover geometry positioning math (`src/services/popover-position.ts`).
7. **Step 7**: Build minimal status/configuration popover UI HTML/CSS (`src/renderer/index.html`).
8. **Step 8**: Wire gain slider, model selector, and hotkey recorder controls independently (`src/renderer/renderer.ts`).
9. **Step 9**: Apply macOS SF Pro visual design polish and accessibility features (`src/renderer/style.css`).
10. **Step 10**: Run focused unit tests, full test suite, TypeScript typecheck, production build, packaged smoke test, and manual macOS focus checks.
