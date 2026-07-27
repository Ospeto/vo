## ADDED Requirements

### Requirement: Native Application Target Resolution
`getActiveAppName()` SHALL query active application state using the native C++ Accessibility addon `pi_paste.node` (`capture()`), resolving active application titles in under 2ms without spawning shell subprocesses.

#### Scenario: Active Application Resolution
- **WHEN** active target application context is requested
- **THEN** system returns the frontmost application title via native C++ Accessibility bindings without executing `osascript`

### Requirement: OS Keychain Encrypted API Key Storage
The system SHALL use Electron `safeStorage` API to encrypt Gemini primary and fallback API keys prior to writing configuration patches to disk, storing ciphertext buffers when `safeStorage.isEncryptionAvailable()` is `true`.

#### Scenario: Encrypted API Key Save
- **WHEN** user saves a Gemini API key
- **THEN** system encrypts key via `safeStorage` and persists encrypted buffer reference in `config.json`

#### Scenario: Encrypted API Key Load
- **WHEN** configuration is loaded from disk
- **THEN** system decrypts API key via `safeStorage` into memory

### Requirement: Canvas Visualizer Idle Throttling
The renderer spectrum visualizer SHALL automatically cancel its `requestAnimationFrame` render loop when audio input level drops below 0.01 or HUD window is hidden.

#### Scenario: Visualizer Idle Pause
- **WHEN** audio input level remains below 0.01
- **THEN** `requestAnimationFrame` loop pauses until input gain pulses above threshold
