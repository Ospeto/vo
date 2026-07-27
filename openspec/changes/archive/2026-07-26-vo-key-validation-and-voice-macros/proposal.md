## Why

To enhance usability and developer feedback in `pi-voice`, users need:
1. Immediate visual validation of their Gemini API Key in the Settings GUI before dictating.
2. Extended spoken voice formatting macros (bullet points, clear line, new line) during hands-free voice typing.

## What Changes

- **Gemini API Key Health Check**: Add a "Test Key" button in `#settingsModal` with live visual status feedback (`Valid API Key` / `Invalid Key`).
- **Spoken Formatting Macros**: Expand `sanitizeTranscribedText` in `src/services/stt.ts` to convert spoken formatting triggers (`bullet point`, `စာကြောင်းသစ်`, `အချက်`) into formatted text.

## Capabilities

### New Capabilities

- `api-key-health-validation`: Live validation button and feedback badge in Settings GUI for Gemini API keys.
- `extended-voice-macros`: Spoken formatting macro conversion in transcription processing.

## Impact

- `src/renderer/index.html`: Added `#testApiKeyBtn` and status feedback element.
- `src/renderer/renderer.ts`: Added click listener for testing API key and displaying status.
- `src/shared/types.ts`: Added IPC channel `TEST_API_KEY`.
- `src/main.ts`: Added IPC handler for `TEST_API_KEY`.
- `src/services/stt.ts`: Added bullet point and formatting macro sanitization rules.
