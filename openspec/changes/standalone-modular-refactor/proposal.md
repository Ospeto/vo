# Change Proposal: Standalone Modular Refactor & Core Extraction

## Summary
Refactor the `yukukotani/pi-voice` (`vo`) codebase to establish a clean, modular architecture with decoupled domain packages (`src/core/`, `src/native/`, `src/ui/`), clean dependency boundaries, and independent build & packaging pipelines.

## Motivation
To transform `pi-voice` into a fully independent, 100% owned, maintainable, modular macOS voice interface product.

## Scope & Architectural Strategy
1. **Core Domain Decoupling**:
   - Organize `src/core/` for state machine, STT provider adapters, configuration, and dictation history.
   - Organize `src/native/` for macOS active window detection, accessibility target validation, and zero-latency clipboard paste logic.
   - Organize `src/ui/` for Electron Main process, Popover GUI renderer, Audio Capture renderer, and CLI Daemon server.
2. **Dependency Cleanup**:
   - Remove unused legacy dependencies and normalize package names in `package.json`.
3. **Build & Test Verification**:
   - Verify that all 220 unit and integration tests pass cleanly (`bun test`).
   - Rebuild production bundle and package standalone `.app` and `.dmg` installers (`bun run dist:dmg`).

## Key Deliverables
- Modular domain directory layout (`src/core/`, `src/native/`, `src/ui/`).
- Cleaned `package.json` with independent build targets.
- 100% passing test suite (220/220).
- Production DMG installer.
