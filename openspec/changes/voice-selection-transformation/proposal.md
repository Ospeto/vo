## Why

When dictating text, fixing typos, rewording sentences, or restructuring code often requires manual keyboard editing. This proposal introduces Highlighted Text Voice Transformation: users can highlight any text in any macOS application, activate dictation, and speak a natural voice instruction (e.g., "Fix grammar", "Make this function async", "Translate to Burmese"). `vo.app` will process the selected text alongside the spoken instruction and automatically replace the highlighted selection with the transformed output.

## What Changes

- **Automatic Selection Detection**: On dictation trigger, check if text is selected in the active foreground app via clipboard (`cmd+c` / `Clipboard API`).
- **Voice Selection Edit Mode**: When highlighted text is detected, route STT to a specialized Transformation Prompt combining the selected text context with the spoken instruction.
- **Direct Replacement Paste**: Replace the highlighted text seamlessly upon completion using clipboard paste.
- **Fallback to Standard Dictation**: Fall back to standard dictation transparently if no text is selected.

## Capabilities

### New Capabilities
- `voice-selection-transform`: Automatic detection of highlighted text, contextual voice instruction processing via Gemini 3.1 Flash Lite, and in-place replacement.

### Modified Capabilities
- None

## Impact

- `src/services/stt.ts`: Add `transcribeSelectionTransform` function and custom prompt formatting for selection editing.
- `src/main.ts` / `src/services/recording-lifecycle.ts`: Intercept recording start to read active clipboard selection.
- `src/services/hotkey-service.ts`: Handle selection state context.
