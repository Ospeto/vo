## Context

The user wants custom vocabulary terms to be scoped to each preset (e.g. programming terms for `code_comment`, academic/prose terms for `burmese_written`) and wants a 60fps Web Audio spectrum visualizer canvas.

## Goals / Non-Goals

**Goals:**
- Store and resolve preset-scoped vocabulary lists in config and STT pipeline.
- Render 60fps audio spectrum visualizer in renderer using `AnalyserNode.getByteFrequencyData()`.
- Provide an interactive UI in renderer to manage vocabulary tags per preset.

## Decisions

### Decision 1: Config Data Structure
`presetVocabulary` will be an object keyed by `DictationPreset`:
```json
{
  "presetVocabulary": {
    "code_comment": ["TypeScript", "Prisma", "SarYayKaung", "Ospeto"],
    "burmese_written": ["MAS 141", "Engram", "FSRS"],
    "email_polish": ["Sprint Review", "Quarterly OKR"]
  }
}
```

### Decision 2: Spectrum Visualizer
Use HTML5 `<canvas id="spectrumCanvas">` with `requestAnimationFrame` drawing 16 frequency bars with smooth neon gradients during `recording` state.
