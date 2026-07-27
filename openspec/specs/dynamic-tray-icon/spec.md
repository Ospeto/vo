# dynamic-tray-icon Specification

## Purpose
TBD - created by archiving change vo-dynamic-tray-icon. Update Purpose after archive.
## Requirements
### Requirement: Dynamic Menu Bar Tray Icon Recording Indicator

The application SHALL update the macOS status bar tray icon image when dictation recording is active, restoring the idle icon when recording finishes.

#### Scenario: Switching Tray Icon on Recording State
- **WHEN** application state transitions to "starting" or "recording"
- **THEN** tray icon image MUST switch to the red recording indicator image
- **WHEN** application state transitions to "idle"
- **THEN** tray icon image MUST restore the standard idle template image

