# Proposal: Audio Input Device Detection & Selection

## Why
Users with external microphones (USB mics, AirPods, audio interfaces) need the ability to explicitly detect, select, and switch between connected microphone input devices in `vo.app` to resolve external microphone capture errors.

## Scope
- Add `audioDeviceId` property to `PiVoiceConfig` and `PiVoiceConfigPatch` in `src/services/config.ts`.
- Update `setupAudioPipeline` in `src/renderer/capture.ts` to accept and use `deviceId` constraint in `getUserMedia`.
- Expose `enumerateAudioDevices` IPC handler in `src/main.ts` and preload script.
- Add an Audio Input Device selector dropdown in the Settings Modal in `src/renderer/index.html` and `src/renderer/renderer.ts`.
- Run unit test suite (`bun test`) to ensure 100% pass across all tests.

## Capabilities
### Modified Capabilities
- `audio-input-device-selection`: Detect all connected audio input devices, display them in settings, and record explicitly from the user-selected microphone device.
