## Context

`vo.app` currently handles voice dictation by recording microphone audio, sending it to Gemini 3.1 Flash Lite with preset system prompts, and pasting the transcribed output into the active focused field via macOS CGEvent / Clipboard injection.

To enable Voice Selection Transformation, `vo.app` needs to detect whether the user currently has text selected in the active application when triggering the hotkey, read that selected text, and adjust the system prompt to perform instructions on the selected text.

## Goals / Non-Goals

**Goals:**
- Detect highlighted text in active macOS foreground application on recording start.
- Construct specialized Gemini 3.1 Flash Lite system instructions for contextual voice transformation.
- In-place replacement of highlighted text via macOS clipboard paste.
- Zero extra user friction: automatic fallback to normal dictation when no text is selected.

**Non-Goals:**
- Permanent text history diff tracking inside the application.
- Multi-caret non-contiguous text selection transformation.

## Decisions

### 1. Selected Text Detection Strategy
- **Choice**: Snapshot the clipboard through the shared `ClipboardPort`, including standard and custom formats, write a sentinel, then issue `cmd+c` through an `osascript` child process. Poll the clipboard text every 20ms until it changes, the bounded timeout expires, or capture is cancelled. Kill the child process and restore the full snapshot on non-selection paths.
- **Alternative Considered**: macOS Accessibility API (`AXUIElementCopyAttributeValue` for `kAXSelectedTextAttribute`).
- **Rationale**: Clipboard copy works reliably across 99% of macOS Electron, Native Cocoa, Web, and Terminal apps without demanding elevated Accessibility API entitlements.

### 2. Dual-Mode STT Routing
- **Choice**: If `activeSelection` is present, include it between delimiter-safe `<selected_text>` tags (escaping embedded closing tags). Preserve the resolved target-language directive and translation-mode setting in the specialized edit prompt, and return only the transformed replacement text.
- **Rationale**: Clear separation prevents Gemini from outputting conversational chatter.

## Risks / Trade-offs

- **[Risk] Clipboard Overwrite**: Copying selected text alters the user's clipboard temporarily.
  - *Mitigation*: Save the complete format-preserving snapshot before copy, and restore it after capture or cancellation.
- **[Risk] Slow or cancelled Selection Copy**: The foreground application or the user may prevent capture from completing.
  - *Mitigation*: Poll for up to the bounded capture window, cancel through `AbortSignal`, clean up the `osascript` child process, and fall back to standard dictation without hiding errors from later recording/transcription states.
