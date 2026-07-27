# Spec Delta: Zero-Cost Performance Optimizations

## Added Requirements

### Requirement: 0ms Mic Hardware Startup & Dead Silence Trimming
The audio capture engine MUST pre-warm microphone streams for 0ms startup lag and trim leading/trailing dead silence buffers prior to API transmission.

#### Scenario: Instant Silence-Trimmed Recording
- **Given** the user presses the hotkey to speak
- **When** audio capture starts and completes
- **Then** recording MUST start instantaneously at 0ms and dead silence leading/trailing audio MUST be trimmed automatically.

### Requirement: Fast DocumentFragment UI Render & Deep-Idle Hibernation
The renderer MUST update history items using `DocumentFragment` in under 2ms, and the main process MUST hibernate idle memory during inactivity.

#### Scenario: Sub-2ms UI Paint
- **Given** new history or status updates
- **When** rendering UI updates in popover window
- **Then** DOM updates MUST complete in under 2ms using batch fragments.
