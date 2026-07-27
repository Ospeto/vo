## Context

Developers dictating code comments or specs in developer applications require project-specific accuracy for symbols, types, and function names. Currently, `stt.ts` uses static application prompt hints. When project-specific names like `resolveConfigPath` are spoken, Gemini lacks context and hallucinates generic English words.

To give users full control, a GUI ON/OFF toggle switch (`symbolScannerEnabled`) will be provided in the Settings Modal.

## Goals / Non-Goals

**Goals:**
- Provide an explicit ON/OFF GUI toggle switch (`symbolScannerEnabled`, default `true`) in the Settings Modal.
- Implement a sub-15ms fast regex/AST symbol scanner for active TypeScript/JavaScript project workspaces when enabled.
- Automatically resolve the active workspace directory based on the active target application.
- Format extracted project symbols into a structured `Active Workspace Identifiers` section inside Gemini's `systemInstruction`.
- Cache project workspace symbols with LRU eviction to prevent repeated disk scanning.

**Non-Goals:**
- Heavy AST parsing of third-party `node_modules` dependencies (only project source files in `src/` or root are scanned).
- Blocking audio recording startup (symbol scanning executes asynchronously parallel to audio capture).

## Decisions

### Decision 1: Settings GUI Toggle Switch (`symbolScannerEnabled`)
- **Choice**: Add a sleek toggle switch in Settings Modal allowing users to enable/disable workspace symbol scanning instantly.
- **Rationale**: Gives users complete control over prompt context expansion and privacy.

### Decision 2: Regex-based Fast Symbol Extraction vs Full Compiler AST Parsing
- **Choice**: Use lightweight regex extraction targeting `export (function|class|interface|type|const) <Name>` and file basenames.
- **Rationale**: Full TypeScript compiler API parsing introduces 300ms-1s latency, whereas regex scanning of project source files takes <10ms, satisfying our sub-15ms budget.

### Decision 3: In-Memory Workspace Symbol Cache with TTL
- **Choice**: Store extracted symbols in an in-memory cache keyed by workspace path with a 30-second TTL.
- **Rationale**: Developers frequently dictate multiple lines in the same project session; caching eliminates redundant disk I/O.

## Risks / Trade-offs

- **[Risk]** Very large repositories (>10,000 files) causing disk scan delay → **Mitigation**: Limit file traversal depth to `src/`, max 50 files, capped at 100 top symbols.
- **[Risk]** Context token overhead in Gemini API payload → **Mitigation**: Top 50 most relevant symbols injected; user can toggle feature OFF in Settings at any time.
