# macOS Menu Bar GUI — Project Plan & Specifications

This directory contains the complete technical plans, research documents, and design specifications for adding a native macOS Menu Bar GUI to `pi-voice`.

## Directory Contents

- **`research_report.md`**: Detailed technical research on Electron Tray, macOS Popover positioning, Web Audio API RMS intensity calculations, Gemini model endpoints, and Glassmorphism design principles.
- **`implementation_plan.md`**: Superpowers Step-by-Step Implementation Plan with architecture sequence diagrams, risk controls, and rollback procedures.
- **`prompt_draft.md`**: Structured requirement specifications and acceptance criteria for agent execution.
- **TDD Test Suite**: Located at `src/__tests__/services/menu-bar-gui.test.ts` (22/22 unit tests passing).

## Quick Commands

Run TDD Test Suite:
```bash
bun test src/__tests__/services/menu-bar-gui.test.ts
```
