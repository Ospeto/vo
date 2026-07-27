# Design: Audio Input Device Selection Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 AUDIO INPUT DEVICE SELECTION ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Settings Modal Device Selector ]                                         │
│  └── List all connected mic devices via navigator.mediaDevices.enumerateDevices()
│                                                                             │
│  [ Config Storage: ~/.config/pi-voice/config.json ]                        │
│  └── audioDeviceId: "default" | "specific-device-id-uuid"                   │
│                                                                             │
│  [ MediaRecorder Capture Engine: src/renderer/capture.ts ]                  │
│  └── getUserMedia({ audio: { deviceId: { exact: audioDeviceId } } })        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
