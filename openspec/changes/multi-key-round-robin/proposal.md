# Proposal: Multi-Key Round-Robin Rotation for Gemini API

## Why
Users want to supply multiple Gemini API keys (comma or newline separated) to rotate requests across keys in a Round-Robin fashion, tripling daily rate limits and automatically failing over if one key hits a rate limit.

## Scope
- Update `src/services/gemini-client.ts` to parse comma/newline-separated API keys into an array and rotate clients using round-robin index.
- Update `src/services/config.ts` helper `getGeminiApiKeys` to extract all valid API keys.
- Update `src/renderer/index.html` settings placeholder and hint for multi-key input.
- Add unit tests for round-robin rotation in `src/__tests__/services/gemini-client.test.ts`.

## Capabilities
### Modified Capabilities
- `multi-key-round-robin`: Support multi-key round-robin rotation and automatic failover across multiple Gemini API keys.
