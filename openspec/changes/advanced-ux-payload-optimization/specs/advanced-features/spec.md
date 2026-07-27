# Spec Delta: Advanced UX & Hesitation Stripping

## Added Requirements

### Requirement: Advanced Spoken Hesitation Sanitization
The `sanitizeTranscribedText` function MUST strip Burmese hesitation fillers (`အာ`, `အင်း`, `ဒီဥစ္စာ`, `, nd-sat`) and English hesitations (`like,`, `you know,`) from transcribed text.

#### Scenario: Hesitation Filler Removal
- **Given** transcribed text containing spoken hesitation fillers
- **When** `sanitizeTranscribedText` processes the string
- **Then** all hesitation artifacts MUST be removed and trailing punctuation normalized.

### Requirement: Hybrid Tap-and-Hold Hotkey Detection
The hotkey service MUST support both Tap-to-Talk (single press to start, single press to stop) and Hold-to-Talk (hold key to record, release to stop).

#### Scenario: Key Release Auto-Stop
- **Given** the user holds down the hotkey for >350ms
- **When** the hotkey is released
- **Then** recording MUST automatically stop and transcribe without requiring a second key press.
