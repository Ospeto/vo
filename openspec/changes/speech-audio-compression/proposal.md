# Proposal: 24kbps Speech Audio Compression Optimization

## Why
Currently, audio recorded by `src/renderer/capture.ts` uses default high-bitrate WebM stereo streaming (~192 KB for 11 seconds). Compressing audio to 16kHz mono / 24kbps Opus WebM reduces the payload size by 6x (to ~32 KB), significantly reducing network upload and Google Gemini API audio decoding latency for long dictations.

## Scope
- Update `navigator.mediaDevices.getUserMedia` audio constraints in `src/renderer/capture.ts` to `sampleRate: 16000`, `channelCount: 1`.
- Set `audioBitsPerSecond: 24000` on `MediaRecorder` in `src/renderer/capture.ts`.
- Run unit test suite (`bun test`) to verify zero regressions.

## Capabilities
### Modified Capabilities
- `speech-audio-compression`: Compress recorded speech audio payload by 6x using 16kHz mono 24kbps Opus WebM encoding.
