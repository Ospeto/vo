# Proposal: Draggable HUD Capsule with Saved Screen Position

## Why
Users love the minimalist micro-waveform HUD capsule pill and want the ability to drag it with their mouse to any preferred position on screen (e.g., center, top-right, near active app window), with its custom position remembered across dictations and app restarts.

## Scope
- Add `-webkit-app-region: drag` and cursor grab styling to `src/renderer/hud.html`.
- Listen for `moved` events on `hudWindow` in `src/main.ts` to save and persist the custom HUD `(x, y)` position.
- Restore the custom HUD position when `hudWindow` is displayed.
- Run unit test suite (`bun test`) to ensure zero regressions.

## Capabilities
### Modified Capabilities
- `draggable-hud-capsule`: Enable mouse dragging on the frosted glass HUD capsule and persist custom screen coordinates.
