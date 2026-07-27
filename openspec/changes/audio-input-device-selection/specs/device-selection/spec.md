# Spec Delta: Audio Input Device Detection & Selection

## Added Requirements

### Requirement: Audio Input Device Enumeration & Selection
The system MUST enumerate all available microphone devices connected to macOS and allow the user to select their desired microphone in the Settings Modal.

#### Scenario: Selecting External Microphone
- **Given** an external microphone is connected to the Mac
- **When** the user opens the Settings Modal and chooses the external microphone
- **Then** `vo.app` MUST record audio exclusively using the selected device ID.
