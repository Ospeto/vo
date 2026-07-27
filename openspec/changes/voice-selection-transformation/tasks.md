## 1. Selection Capture Service

- [x] 1.1 Implement active text selection capture function using clipboard copy and restore in `src/services/selection-service.ts`
- [x] 1.2 Add timeout-guarded text selection detection on hotkey press in `src/services/recording-lifecycle.ts`

## 2. Gemini Selection Transformation STT Engine

- [x] 2.1 Update `TranscribeOptions` in `src/services/stt.ts` to support `selectedText` parameter
- [x] 2.2 Construct AI Text Transformation system prompt instructions in `transcribeGemini` when `selectedText` is present
- [x] 2.3 Ensure text sanitization bypasses raw text filters during selection transformation mode

## 3. Integration & Testing

- [x] 3.1 Write unit tests for selection capture and STT prompt routing in `src/__tests__/services/selection-transform.test.ts`
- [x] 3.2 Verify end-to-end full build and test suite pass with 100% success
