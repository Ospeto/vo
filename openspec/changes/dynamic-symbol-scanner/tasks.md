## 1. Config & GUI Settings Toggle Switch

- [x] 1.1 Add `symbolScannerEnabled` boolean option (default `true`) to `src/services/config.ts` schema
- [x] 1.2 Add ON/OFF toggle switch for "Dynamic Workspace Symbol Scanner" in `src/renderer/index.html`
- [x] 1.3 Wire IPC listeners and IPC handlers for `symbolScannerEnabled` state in `src/renderer/renderer.ts` and `src/main.ts`

## 2. Symbol Extraction Service

- [x] 2.1 Create `src/services/symbol-scanner.ts` with regex export symbol scanner
- [x] 2.2 Implement workspace path resolution and caching with TTL
- [x] 2.3 Write unit tests in `src/__tests__/services/symbol-scanner.test.ts`

## 3. Gemini STT Prompt Context Integration

- [x] 3.1 Update `transcribeGemini` in `src/services/stt.ts` to check `symbolScannerEnabled` and accept workspace symbols
- [x] 3.2 Format `Active Workspace Identifiers` section in `systemInstruction` when enabled
- [x] 3.3 Verify prompt formatting with unit test suite
