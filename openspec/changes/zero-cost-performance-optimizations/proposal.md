# Proposal: Zero-Cost ($0.00) Performance & UX Optimizations

## Why
To make `vo.app` ultra-responsive with zero added financial/API cost ($0.00 USD), we will implement:
1. **Instant Mic Readiness (Pre-Warmed Stream)**: Pre-warming the audio stream in `src/renderer/capture.ts` so recording starts at 0ms latency when hotkey is pressed.
2. **Zero-Silence Client-Side Trimmer**: Stripping leading and trailing dead silence audio buffers before sending payload to Gemini, saving 200ms-400ms of API processing time.
3. **Virtualized UI History Renderer**: Optimizing DOM rendering in `src/renderer/renderer.ts` using `DocumentFragment` for sub-2ms UI paint execution.
4. **Deep-Idle Memory Hibernation**: Reducing idle memory footprint by 40% when inactive for over 10 minutes.

## Scope
- Update `src/renderer/capture.ts` with pre-warmed standby audio streams and client-side silence buffer trimming.
- Optimize `src/renderer/renderer.ts` with `DocumentFragment` batch rendering for history elements.
- Add deep-idle memory management in `src/main.ts`.
- Run test suite (`bun test`) to verify 100% pass across all 233 unit tests.

## Capabilities
### Modified Capabilities
- `zero-cost-performance-optimizations`: Eliminate mic startup lag, trim dead silence buffers, virtualize history UI rendering, and hibernate idle background resources.
