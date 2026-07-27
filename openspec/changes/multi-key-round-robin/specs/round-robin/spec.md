# Spec Delta: Multi-Key Round-Robin Rotation

## Added Requirements

### Requirement: Round-Robin API Key Rotation
The system MUST support comma-separated or newline-separated Gemini API keys and rotate between them sequentially for each dictation request.

#### Scenario: Multiple API Keys Configured
- **Given** three API keys configured in `geminiApiKey`: `"KEY1, KEY2, KEY3"`
- **When** three consecutive dictation requests are dispatched
- **Then** request 1 MUST use `KEY1`, request 2 MUST use `KEY2`, and request 3 MUST use `KEY3`.
