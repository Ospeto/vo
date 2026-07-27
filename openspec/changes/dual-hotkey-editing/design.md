# Design: Dual Hotkey Architecture & Configurable Voice Edit Key

## Context
Previously, `vo.app` relied on a single hotkey for both dictation and voice text editing. When text was highlighted, the single-prompt STT attempted to guess whether the spoken audio was a command (e.g., "translate") or new dictation text. This caused conflicts and unpredictability.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    DUAL HOTKEY ARCHITECTURE OVERVIEW                      │
└───────────────────────────────────────────────────────────────────────────┘

     ┌─────────────────────────────────────────────────────────────────┐
     │                     User Hotkey Press                           │
     └─────────────────────────────────────────────────────────────────┘
                                     │
               ┌─────────────────────┴─────────────────────┐
               ▼                                           ▼
  ┌─────────────────────────┐                 ┌─────────────────────────┐
  │ Dictation Hotkey        │                 │ Voice Edit Hotkey       │
  │ (key / ctrl+cmd+opt+v)  │                 │ (editKey / ctrl+cmd+e)  │
  └────────────┬────────────┘                 └────────────┬────────────┘
               │                                           │
               ▼                                           ▼
  ┌─────────────────────────┐                 ┌─────────────────────────┐
  │ Pure Dictation Mode     │                 │ Voice AI Edit Mode      │
  │ - Overwrites Selection  │                 │ - Captures Selection    │
  │ - Standard Dictation    │                 │ - AI Command Transform  │
  └─────────────────────────┘                 └─────────────────────────┘
```

## Key Technical Decisions

1. **Config Schema (`src/services/config.ts`)**:
   Add `editKey` to `piVoiceConfigSchema` with Zod validation. Default: `"ctrl+cmd+option+e"`.

2. **Hotkey Service (`src/services/hotkey-service.ts`)**:
   Update `HotkeyService` to maintain two active listeners:
   - `dictationHotkey` (`key`): Triggers `handleHotkeyDown("dictate")`.
   - `editHotkey` (`editKey`): Triggers `handleHotkeyDown("edit")`.

3. **Main Process State & Routing (`src/main.ts`)**:
   - `currentTriggerMode`: `"dictate" | "edit"`.
   - In `"dictate"` mode:
     If text is selected, clipboard is cleared and newly dictated text replaces the highlight.
   - In `"edit"` mode:
     If text is selected, Gemini receives `selectedText` and executes AI transformation (e.g. translate, summarize, fix).

4. **HUD Visual Differentiation (`src/renderer/hud.html`)**:
   - Dictation Mode: Standard Red/Emerald Capsule.
   - Voice Edit Mode: Glowing Purple Border, Violet Waveform, and Glowing Edit Icon.
