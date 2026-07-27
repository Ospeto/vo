## Context

Users dictate speech in different active applications. Manually changing presets each time they switch between VSCode and Slack creates UI friction.

## Goals / Non-Goals

**Goals:**
- Implement `resolveEffectivePreset(preset, appName)` in `stt.ts`.
- Map frontmost app names to target presets automatically when `preset === "auto"`.
- Provide `auto` option in config schema, UI dropdown, and test suite.

**Non-Goals:**
- Custom per-app mapping UI (built-in smart default mapping is sufficient for core app categories).

## Decisions

### Decision 1: Built-in Category Mapping Rules
- **Code Editors & Terminals** (`VSCode`, `Cursor`, `Terminal`, `Warp`, `iTerm`, `Ghostty`) ──► `code_comment`
- **Email & Messaging** (`Slack`, `Mail`, `Outlook`, `Telegram`, `Teams`, `Messages`) ──► `email_polish`
- **Notes & Docs** (`Obsidian`, `Notion`, `Bear`, `Pages`, `Word`) ──► `burmese_written`
- **Fallback / Others** ──► `fast`
