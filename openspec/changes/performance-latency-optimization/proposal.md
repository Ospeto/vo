# Proposal: Performance & Latency Optimization (-600ms Speedup)

## Why
The current dictation-to-paste pipeline experiences ~600ms of avoidable local latency before sending audio to Gemini. This stems from synchronous workspace symbol disk scanning (`scanWorkspaceSymbols`), synchronous AppleScript execution (`getActiveAppName`), and cold TLS HTTP/2 socket negotiation. Optimizing these three leverage points cuts ~600ms of end-to-end dictation latency with zero added financial/API cost.

## Scope
1. **Asynchronous Background Symbol Scanner**: Move `scanWorkspaceSymbols` execution to asynchronous background caching in `src/services/symbol-scanner.ts`.
2. **Cached Active App Lookup**: Optimize `getActiveAppName` in `src/services/stt.ts` to cache frontmost application window metadata asynchronously, removing AppleScript `execSync` latency.
3. **HTTP/2 Socket Warm Keeping**: Maintain warm HTTP/2 keep-alive socket connections in `src/services/gemini-client.ts` during idle states to eliminate TLS handshake latency.
4. **Unit Test Audit**: Add unit tests in `src/__tests__/services/symbol-scanner.test.ts` and `src/__tests__/services/stt.ts` to verify sub-5ms pre-transcription preparation.

## Capabilities
### Modified Capabilities
- `performance-latency-optimization`: Reduce pre-transcription latency by ~600ms through async background scanning, cached frontmost app lookups, and HTTP/2 socket warm keeping.
