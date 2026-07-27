# Spec Delta: Default Dictation Preset Changed to Careful Mode

## Added Requirements

### Requirement: Default Dictation Preset Configuration
The system MUST use `"careful"` as the default dictation preset across configuration defaults and UI initializations.

#### Scenario: Launching App for First Time
- **Given** no custom configuration exists
- **When** `vo.app` is launched
- **Then** the dictation preset MUST default to `"careful"`.
