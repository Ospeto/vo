# Spec Delta: Persistent Cost Ledger & Deduplication Engine

## Added Requirements

### Requirement: Persistent Cost Storage Across App Updates
The system MUST persist history and cost ledger data in `~/.config/pi-voice/` so that app updates or reinstalls do NOT delete or reset cost history.

#### Scenario: App Update Data Retention
- **Given** history and cost entries recorded in `~/.config/pi-voice/`
- **When** the application is updated or reinstalled in `/Applications/vo.app`
- **Then** all historical costs, monthly totals, and recent history items MUST remain intact and accessible.

### Requirement: Cumulative Monthly & Lifetime Cost Tracking
The system MUST track cumulative monthly and lifetime costs in a dedicated `cost-ledger.json` file independently of history item limit pruning.

#### Scenario: History Limit Pruning
- **Given** history storage exceeds the 200 item limit and older text entries are pruned
- **When** monthly or lifetime cost totals are retrieved
- **Then** the pruned items' cost values MUST still be preserved in the cumulative ledger.

### Requirement: Time-Window Cost Deduplication
The system MUST reject duplicate cost history entries if an entry with identical text and cost is logged within 3000ms.

#### Scenario: Duplicate Event Prevention
- **Given** a dictation entry logged at time T
- **When** an identical text and cost entry is submitted within 3000ms of time T
- **Then** the duplicate entry MUST be ignored and NOT double-counted.
