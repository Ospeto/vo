# Proposal: Fallback Paid API Key Support

## Why
Users want an optional "Fallback Paid API Key" field to act as an emergency backup. If all primary free round-robin keys hit rate limits or quota errors, dictation requests seamlessly fail over to the paid key to ensure 99.99% dictation uptime.

## Scope
- Add `geminiFallbackApiKey?: string` to `PiVoiceConfig` and Zod schema in `src/services/config.ts`.
- Implement `executeGeminiWithFallback` and `getGeminiFallbackClient` in `src/services/gemini-client.ts`.
- Add Fallback API Key input field in `src/renderer/index.html` and `src/renderer/renderer.ts`.
- Add unit tests for fallback API key failover in `src/__tests__/services/gemini-client.test.ts`.

## Capabilities
### Modified Capabilities
- `fallback-paid-api-key`: Seamless automatic failover to dedicated Paid Fallback API Key when primary free keys encounter rate limits or quota errors.
