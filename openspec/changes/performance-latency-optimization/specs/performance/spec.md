# Spec Delta: Performance & Latency Optimization

## Added Requirements

### Requirement: Sub-10ms Pre-Transcription Overhead
The pre-transcription preparation phase MUST complete in under 10ms by using cached workspace symbols, cached active application metadata, and warm HTTP/2 sockets.

#### Scenario: Instant Audio Submission
- **Given** the user finishes dictation and triggers stop
- **When** `transcribeGemini` prepares the prompt payload
- **Then** `scanWorkspaceSymbols` and `getActiveAppName` MUST return cached results in under 5ms without blocking synchronous disk I/O or AppleScript execution.
