## Why

Spoken dictation in developer code editors (e.g., VS Code, Cursor, Myanso, Terminals) often suffers from LLM hallucinations when developers speak project-specific identifiers, function names, and file symbols (e.g. `resolveConfigPath`, `settleMatchingLifecycleError`, `ChimeSoundChoice`). While generic programming terms are recognized accurately, project-specific dictation is misinterpreted into generic English text or incorrect words.

To achieve zero-hallucination code dictation accuracy while giving users full control, `pi-voice` needs a real-time Dynamic Workspace Symbol Scanner with an optional ON/OFF GUI toggle switch in Settings.

## What Changes

- **Workspace Symbol Extractor Service**: Lightweight, sub-20ms AST/regex symbol extractor that scans exported symbols, function signatures, interface names, type aliases, and file names from the active project workspace.
- **Active Window Project Auto-Resolver**: Resolves active process environment and working project directory when dictating in developer tools (VS Code, Cursor, Myanso, Terminals).
- **Settings Toggle Switch (`symbolScannerEnabled`)**: Optional ON/OFF toggle switch in the Settings Modal (defaults to `true`).
- **Dynamic Prompt Vocabulary Injection**: Enriches `systemInstruction` with `Active Workspace Identifiers` and `Module Context` dynamically during Gemini STT transcription when `symbolScannerEnabled` is ON.
- **Symbol Cache**: Caches extracted symbols per project workspace with LRU eviction to maintain near-zero STT latency (<15ms overhead).

## Capabilities

### New Capabilities
- `symbol-scanner`: Automated workspace symbol extraction, settings toggle switch (`symbolScannerEnabled`), and dynamic prompt context enrichment for zero-hallucination code dictation.

### Modified Capabilities
*(None - existing API contracts and UI behaviors are preserved)*

## Impact

- `src/services/config.ts`: Updated to support `symbolScannerEnabled` boolean configuration.
- `src/renderer/index.html` & `src/renderer/renderer.ts`: Added ON/OFF toggle switch in Settings Modal.
- `src/services/stt.ts`: Updated to accept and incorporate dynamic workspace symbols into `systemInstruction` when enabled.
- `src/services/symbol-scanner.ts`: New service module for scanning exported symbols and workspace identifiers.
