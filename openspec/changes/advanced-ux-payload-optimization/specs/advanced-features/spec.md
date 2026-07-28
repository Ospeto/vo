# Spec Delta: Advanced UX & Hesitation Stripping

## Added Requirements

### Requirement: Advanced Spoken Hesitation Sanitization
The `sanitizeTranscribedText` function MUST strip Burmese hesitation fillers (`အာ`, `အင်း`, `ဒီဥစ္စာ`, `, nd-sat`) and English hesitations (`like,`, `you know,`) from transcribed text.

#### Scenario: Hesitation Filler Removal
- **Given** transcribed text containing spoken hesitation fillers
- **When** `sanitizeTranscribedText` processes the string
- **Then** all hesitation artifacts MUST be removed and trailing punctuation normalized.

### Requirement: Configured Tap-and-Hold Hotkey Modes
The application MUST support both Toggle Mode (single press to start, single press to stop) and Hold Mode (hold key to record, release to stop), selected by the persisted `dictationMode` setting.

#### Scenario: Hold Mode Key Release Auto-Stop
- **Given** `dictationMode` is set to `hold`
- **When** the hotkey is released
- **Then** recording MUST automatically stop and transcribe without requiring a second key press.

#### Scenario: Toggle Mode Key Release
- **Given** `dictationMode` is set to `toggle`
- **When** the hotkey is released
- **Then** recording MUST remain active until the next hotkey press or configured auto-endpointing.
