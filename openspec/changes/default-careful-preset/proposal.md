# Proposal: Default Dictation Preset Changed to Careful Mode

## Why
Users prefer "Careful" mode as the default dictation preset across `vo.app` to enjoy maximum accuracy and grammar proofreading out of the box.

## Scope
- Update `DEFAULT_DICTATION_PRESET` to `"careful"` in `src/services/config.ts`.
- Set `"careful"` as the default selected option in `src/renderer/index.html`.
- Run unit test suite (`bun test`) to verify 100% pass across all tests.

## Capabilities
### Modified Capabilities
- `default-careful-preset`: Set Careful proofread mode as the default dictation preset for all new/default configurations.
