## Why

When the popover GUI window is closed or hidden, users cannot see whether dictation recording is active or processing. Adding dynamic macOS menu bar tray icon state indicators (glowing red recording dot, amber processing dot) provides immediate visual feedback directly in the status bar.

## What Changes

- **Dynamic Tray Icon State Switching**: Update `setState(newState, message)` in `src/main.ts` to switch the tray icon between `idle`, `recording`, and `transcribing` states.
- **High-Resolution Tray Assets**: Add `tray-recording.png` (16x16) and `tray-recording@2x.png` (32x32) with a vibrant glowing red recording dot indicator.
- **Asset Asset Copy Pipeline**: Ensure new tray icon PNG assets are copied during `build:electron`.

## Capabilities

### New Capabilities

- `dynamic-tray-icon`: Dynamic status bar tray icon state indicators for recording and transcribing states.

### Modified Capabilities

None.

## Impact

- `src/main.ts`: Tray icon state switching in `setState`.
- `src/assets/`: New tray icon PNG files (`tray-recording.png`, `tray-recording@2x.png`).
