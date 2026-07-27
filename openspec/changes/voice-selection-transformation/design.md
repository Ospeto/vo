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
- **Choice**: Execute a rapid clipboard copy (`cmd+c` simulation or `clipboard.readText()`) upon hotkey press. Compare text before and after. If new text is captured, store it as `activeSelection`. Restore original clipboard after operation.
- **Alternative Considered**: macOS Accessibility API (`AXUIElementCopyAttributeValue` for `kAXSelectedTextAttribute`).
- **Rationale**: Clipboard copy works reliably across 99% of macOS Electron, Native Cocoa, Web, and Terminal apps without demanding elevated Accessibility API entitlements.

### 2. Dual-Mode STT Routing
- **Choice**: If `activeSelection` is present:
  - System Prompt: `You are an AI Text Editor and Transformation Assistant. Perform the spoken instruction on the provided Selected Text. Output ONLY the transformed replacement text without wrapping quotes or commentary.`
  - Content Payload: `[Selected Text]: "${activeSelection}" \n [Spoken Instruction]: (audio input)`
- **Rationale**: Clear separation prevents Gemini from outputting conversational chatter.

## Risks / Trade-offs

- **[Risk] Clipboard Overwrite**: Copying selected text alters user's clipboard temporarily.
  - *Mitigation*: Save existing clipboard content before copy, and restore original content after paste completes.
- **[Risk] Slow Selection Copy**: In laggy apps, `cmd+c` might take >50ms.
  - *Mitigation*: Set a strict 50ms timeout for selection copy; if it times out, proceed seamlessly to standard dictation.
