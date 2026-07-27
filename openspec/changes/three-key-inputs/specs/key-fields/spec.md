# Spec Delta: 3 Dedicated Primary API Key Input Fields

## Added Requirements

### Requirement: 3 Dedicated Primary API Key Input Fields
The system MUST provide three separate input fields for Primary Gemini API Keys in the Settings UI and combine non-empty values for Round-Robin rotation.

#### Scenario: User Enters Keys in Separate Fields
- **Given** user enters Key 1 and Key 2 in separate input fields
- **When** user clicks Save
- **Then** the system MUST save them and enable Round-Robin rotation across Key 1 and Key 2.
