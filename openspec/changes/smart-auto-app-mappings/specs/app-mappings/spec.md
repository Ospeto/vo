# Spec Delta: Configurable Smart Auto App Preset Mappings

## Added Requirements

### Requirement: Custom App Preset Mapping
The system MUST allow users to associate specific macOS application names with dictation presets, automatically selecting the mapped preset when dictating inside those applications in Smart Auto Mode.

#### Scenario: Custom App Mapping Resolution
- **Given** the user maps "Xcode" to `code_comment`
- **When** dictating in Smart Auto Mode while Xcode is active
- **Then** the system MUST select the `code_comment` dictation preset.
