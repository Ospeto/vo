# Spec Delta: Fallback Paid API Key Support

## Added Requirements

### Requirement: Fallback Paid API Key Failover
The system MUST attempt primary round-robin API keys first, and automatically fall back to the dedicated `geminiFallbackApiKey` if all primary keys fail due to rate limit (429) or quota errors.

#### Scenario: Primary Keys Rate Limited
- **Given** primary keys are rate limited (HTTP 429) and a `geminiFallbackApiKey` is configured
- **When** dictation request is executed
- **Then** the system MUST execute the request using the `geminiFallbackApiKey` client.
