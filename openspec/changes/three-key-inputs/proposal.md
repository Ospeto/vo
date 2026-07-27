# Proposal: 3 Dedicated Primary API Key Input Fields

## Why
Users find comma-separated password inputs inconvenient and visually messy. Providing 3 separate input fields (Key 1, Key 2, Key 3) improves UX while combining them under the hood into Round-Robin rotation.

## Scope
- Update `src/renderer/index.html` to render 3 dedicated input fields for Primary Gemini API Keys.
- Update `src/renderer/renderer.ts` to populate and save Key 1, Key 2, and Key 3 seamlessly.
- Run unit test suite (`bun test`) to verify 100% pass across all tests.

## Capabilities
### Modified Capabilities
- `three-key-inputs`: Provide 3 separate dedicated input fields for Primary Gemini API Keys in the Settings UI.
