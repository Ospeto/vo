# Spec Delta: 24kbps Speech Audio Compression

## Added Requirements

### Requirement: 16kHz 24kbps Opus Audio Stream Compression
The audio capture pipeline MUST encode microphone input as 16kHz mono 24kbps Opus WebM to minimize payload size and transmission latency.

#### Scenario: Compressed Speech Recording
- **Given** the user starts dictation and speaks
- **When** the microphone audio is captured by MediaRecorder
- **Then** the output stream MUST be encoded at 24kbps Opus 16kHz mono with ~6x reduced byte payload size.
