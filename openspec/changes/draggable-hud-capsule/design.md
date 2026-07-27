# Design: Draggable HUD Capsule Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 DRAGGABLE HUD CAPSULE ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ CSS Drag Region: src/renderer/hud.html ]                                 │
│  └── -webkit-app-region: drag; cursor: grab / grabbing;                    │
│                                                                             │
│  [ Electron Window Move Event: src/main.ts ]                                │
│  └── hudWindow.on('moved') ➔ save custom (x, y) coordinates                 │
│                                                                             │
│  [ Show / Restore Position ]                                                │
│  └── Applies custom saved (x, y) position on state changes                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
