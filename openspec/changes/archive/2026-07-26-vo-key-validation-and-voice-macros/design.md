## Context

Users entering an API key in Settings cannot currently verify if the key works without attempting a dictation. Additionally, spoken voice formatting commands need cleaner handling.

## Goals

- Provide 1-click API key testing in the Settings modal with instant visual status feedback.
- Expand spoken formatting macros for bullets and line breaks in `sanitizeTranscribedText()`.

## Decisions

- **IPC Channel `TEST_API_KEY`**: Handled in `src/main.ts` by instantiating GoogleGenAI with the input key and running a lightweight test request.
- **Voice Macros**: Replace spoken Burmese/English bullet phrases (`bullet point`, `အချက်`) with `- ` prefixes in `sanitizeTranscribedText()`.
