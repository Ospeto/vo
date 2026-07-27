## Context

Currently, the macOS menu bar tray icon remains a static template image (`tray-idleTemplate.png`). Users cannot determine whether dictation is recording or transcribing without focusing or opening the popover GUI window.

## Goals / Non-Goals

**Goals:**
- Dynamically update the tray icon image when state changes to `recording` or `starting` (glowing red dot).
- Restore template icon when state returns to `idle`.
- Support macOS light & dark menu bar themes.

**Non-Goals:**
- Animating SVG tray icons in menu bar (Electron macOS native tray does not support SVG animations).

## Decisions

- **Pre-rendered PNG Icons**: Use native high-DPI 16x16 (`@1x`) and 32x32 (`@2x`) PNG images for crisp status rendering across Retina and non-Retina displays.
- **State Listener**: Intercept state changes in `setState()` inside `src/main.ts`.

## Risks / Trade-offs

- [Risk] Missing asset files on package build → Mitigation: Explicitly include all `tray-*.png` files in asset copy scripts and `package.json` `files`.
