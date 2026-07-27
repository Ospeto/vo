## ADDED Requirements

### Requirement: Settings GUI Toggle Switch
The system SHALL provide an ON/OFF toggle switch for "Dynamic Workspace Symbol Scanner" in the Settings Modal, persisted under `symbolScannerEnabled` in configuration (defaulting to `true`).

#### Scenario: User toggles Symbol Scanner setting
- **WHEN** user opens Settings Modal and toggles "Dynamic Symbol Scanner" switch
- **THEN** system updates `symbolScannerEnabled` configuration state and persists it to disk

### Requirement: Workspace Symbol Extraction
The system SHALL scan and extract exported TypeScript/JavaScript function identifiers, class names, interface names, type aliases, and file names from the active project workspace directory upon dictation initialization when `symbolScannerEnabled` is `true`.

#### Scenario: Active workspace scanning when enabled
- **WHEN** user initiates recording in a code editor app and `symbolScannerEnabled` is `true`
- **THEN** system extracts exported symbols from the active project directory within 15 milliseconds and caches them

#### Scenario: Active workspace scanning when disabled
- **WHEN** user initiates recording in a code editor app and `symbolScannerEnabled` is `false`
- **THEN** system skips workspace symbol extraction and proceeds with standard dictation prompt hints

### Requirement: Prompt Context Enrichment for Code Dictation
The system SHALL append the extracted active workspace symbols to Gemini's `systemInstruction` under an explicit `Active Workspace Identifiers` block when `symbolScannerEnabled` is `true` and `code_comment` or `auto` preset is active.

#### Scenario: Code dictation with project symbols
- **WHEN** user speaks project-specific function or variable names (e.g., `resolveConfigPath`) while in a code editor with `symbolScannerEnabled` ON
- **THEN** system injects `Active Workspace Identifiers` into `systemInstruction` ensuring exact verbatim symbol spelling without generic English translation hallucination
