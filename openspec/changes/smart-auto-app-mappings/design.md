# Design: Smart Auto App Mappings Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 SMART AUTO APP MAPPINGS ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Collapsible Settings Drawer: Smart Auto App Rules ]                      │
│  └── Render user-defined mappings & add new app rules                       │
│                                                                             │
│  [ Persistent Config: appPresetMappings in ~/.config/pi-voice/config.json ] │
│  └── Record<string, DictationPreset>                                        │
│                                                                             │
│  [ Preset Resolver: src/services/stt.ts ]                                   │
│  └── resolveEffectivePreset(preset, appName, customMappings)               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
