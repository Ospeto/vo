# Design: Default Dictation Preset Architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 DEFAULT DICTATION PRESET ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Default Config: src/services/config.ts ]                                 │
│  └── DEFAULT_DICTATION_PRESET = "careful"                                   │
│                                                                             │
│  [ HTML Select Dropdown: src/renderer/index.html ]                         │
│  └── <option value="careful" selected>Careful (Default)</option>            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
