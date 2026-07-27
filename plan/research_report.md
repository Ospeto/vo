# Technical Research Report: macOS Menu Bar GUI for pi-voice

## Executive Summary
This report outlines the technical architecture, component design, and API integration strategy for implementing a native **macOS Menu Bar (Tray) GUI** for `pi-voice`. The new GUI will feature a glassmorphism interface with voice intensity control, Gemini model switching (2.5 Flash / 3.1 Flash Lite), reconfigurable hotkeys, and real-time app status indicators.

---

## 1. Architectural Overview & System Components

```mermaid
graph TD
    Tray[macOS Menu Bar Tray Icon] -->|Click Event| Window[Popover Glass Window]
    Window --> UI[Renderer GUI Component]
    
    subgraph GUI Panel (Glassmorphism UI)
        Status[Status Indicator: Idle / Recording / Transcribing]
        VolSlider[Voice Intensity & Input Gain Slider]
        ModelSel[Gemini Model Selector: 2.5 Flash vs 3.1 Flash Lite]
        Hotkeys[Shortcut Key Recorder & Binding]
    end
    
    UI -->|IPC Calls| Main[Electron Main Process]
    Main -->|Updates Config| Config[Config Service (.pi/pi-voice.json)]
    Main -->|Model Config| STT[STT Service (Gemini API / Client)]
    Main -->|Shortcut Reg| ShortcutService[globalShortcut & FnHook]
    Main -->|Audio Stream Level| AudioEngine[Web Audio API / Renderer Mic Engine]
```

---

## 2. Component Design & Technical Requirements

### 2.1 Native macOS Menu Bar (Tray) Integration
- **Electron API**: Utilize `Tray` and `Menu` modules from `electron`.
- **Icon Assets**: High-DPI template images (`iconTemplate@2x.png`) supporting macOS native light/dark mode auto-tinting.
- **Window Positioning**: Popover window attached directly below the menu bar item bounds using `tray.getBounds()` and dynamic offset calculation.
- **Window Blur/Vibrancy**: Native macOS vibrancy using `vibrancy: "under-window"` or CSS `backdrop-filter: blur(24px) saturate(180%)`.

### 2.2 Voice Intensity & Audio Input Volume Control
- **Input Gain Control**: Web Audio API `GainNode` connected between `MediaStreamAudioSourceNode` and audio processor in renderer process (`src/renderer/renderer.ts`).
- **Intensity Meter**: Real-time RMS (Root Mean Square) volume level calculated via `AnalyserNode` and passed to visual sound bar/wave animation.
- **IPC Sync**: Persist user gain level (0.0 to 2.0x) in `.pi/pi-voice.json`.

### 2.3 Gemini Model Selection (2.5 Flash vs 3.1 Flash Lite)
- **Supported Endpoints**:
  - `gemini-3.1-flash-lite` (Default ultra-low latency model)
  - `gemini-2.5-flash` (High-reasoning accurate transcription model)
- **Config Service Update**: Extend `PiVoiceConfig` schema in `src/services/config.ts` to include `geminiModel: "gemini-3.1-flash-lite" | "gemini-2.5-flash"`.
- **STT Dynamic Selection**: Pass configured model down to `transcribeGemini()` in `src/services/stt.ts`.

### 2.4 Customizable Hotkeys / Keybindings
- **Key Recorder Component**: Interactive hotkey recorder capturing pressed modifier keys + main keys.
- **Global Shortcut Handler**: Dynamic re-registration using `globalShortcut.register()` and parsing keybindings into `uiohook-napi` keycodes for native `FnHook`.
- **Persistence**: Save key string (e.g. `ctrl+cmd+option+v` or `shift+cmd+space`) directly into `.pi/pi-voice.json`.

### 2.5 Glassmorphism UI Design System
- **Theme**: Dark glass design with CSS background blur: `background: rgba(22, 22, 30, 0.65)`, `backdrop-filter: blur(20px)`, `border: 1px solid rgba(255, 255, 255, 0.12)`.
- **Typography**: Inter / system UI font stack with high contrast silver/white text and vibrant accent glows (`#3b82f6` / `#8b5cf6`).
- **Status Indicator**: Dynamic glowing badge with state-driven color transitions:
  - 🟢 **Idle**: Ambient soft emerald glow (`#10b981`)
  - 🔴 **Recording**: Active pulsing ruby/rose glow (`#f43f5e`) + live audio meter waveform
  - 🟡 **Transcribing**: Spinning amber/violet aura (`#f59e0b`)
  - 🔴 **Error**: Red warning pulse (`#ef4444`)

---

## 3. Implementation Steps & Tasks

1. **Tray & Window Setup (`src/main.ts`)**
   - Instantiate `Tray` with template icon.
   - Configure window bounds & popover behavior (`tray.on('click')`).
2. **IPC API Extension (`src/shared/types.ts`)**
   - Add IPC channels: `GET_CONFIG`, `SAVE_CONFIG`, `AUDIO_LEVEL_UPDATE`, `STATE_CHANGE`.
3. **Renderer Glass UI (`src/renderer/`)**
   - Build HTML/CSS glassmorphism dashboard layout.
   - Add status bar, model selector dropdown, intensity volume slider, shortcut key capture input.
4. **Backend Integration (`src/services/`)**
   - Update `config.ts` schema for `model` and `volumeGain`.
   - Update `stt.ts` to respect user-configured model.

---

## 4. Verification & Testing Strategy
- **Tray Toggle Test**: Verify popup window toggles correctly from menu bar click without stealing focus from active input apps.
- **Transcription Test**: Verify audio is transcribed using selected model (`gemini-2.5-flash` vs `gemini-3.1-flash-lite`).
- **Hotkey Test**: Test dynamic re-binding of hotkeys and verify global shortcut triggers dictation clean end-to-end.
