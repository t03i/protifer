# plan-limits Specification

## Purpose

TBD - created by archiving change per-account-limit-overrides. Update Purpose after archive.

## Requirements

### Requirement: Plan class versus quota separation

The system SHALL treat an account's `plan` as a scheduling **class** (queue priority and SLO bucket) and SHALL resolve numeric **quota** limits separately, so that two accounts on the same class MAY enforce different quotas.

The quota envelope SHALL consist of: `submissionsPerMinute`, `maxConcurrentJobs`, `maxSequenceLength`, and `sloSeconds`.

#### Scenario: Class still drives scheduling

- **WHEN** an account's queue priority or SLO bucket is selected
- **THEN** the system uses the `plan` enum (`free` | `pro` | `enterprise`) and ignores any per-account quota override

#### Scenario: Quota resolved independently of class

- **WHEN** a quota limit is enforced for an account
- **THEN** the system uses the resolved effective limit, not a direct `PLAN_LIMITS[plan]` lookup at the call site

### Requirement: Effective limit resolution

The plan resolver SHALL return an `EffectiveLimits` object computed by merging a per-account override over the plan-class default on a field-by-field basis. An absent override object, an absent field, or a resolution failure SHALL fall back to the plan-class default for that field.

#### Scenario: No override present

- **WHEN** an account has no `limits` override stored
- **THEN** every effective limit equals the corresponding `PLAN_LIMITS[plan]` (and SLO default) value

#### Scenario: Partial override merges field-by-field

- **WHEN** an account's override sets only `maxConcurrentJobs`
- **THEN** `maxConcurrentJobs` uses the override value and all other limits fall back to the plan-class default

#### Scenario: Resolution failure is safe

- **WHEN** the override store read fails or returns an unparseable value
- **THEN** the resolver logs a warning and returns the plan-class defaults without throwing

### Requirement: Override storage and validation

Per-account overrides SHALL be stored in a nullable `limits jsonb` column on the Postgres `user` table as a sparse partial object. The system SHALL validate override values against a schema before applying them: each present field MUST be a positive integer (or zero where the underlying default permits zero, e.g. an SLO bucket), and unknown fields SHALL be rejected.

#### Scenario: Valid sparse override accepted

- **WHEN** an override `{ "submissionsPerMinute": 1000 }` is validated
- **THEN** validation passes and only `submissionsPerMinute` is overridden

#### Scenario: Invalid override rejected

- **WHEN** an override contains a negative number, a non-integer, or an unknown field
- **THEN** validation fails and the override is not persisted

### Requirement: Admin-only override management

The system SHALL expose admin-only endpoints to set and clear an account's limit override, mirroring the existing admin flag-override authorization. Overrides SHALL NOT be settable or viewable through any user-facing (non-admin) route.

#### Scenario: Admin sets an override

- **WHEN** an authenticated admin sends a valid override for an account via the admin route
- **THEN** the override is persisted and subsequent submissions for that account enforce the merged effective limits

#### Scenario: Admin clears an override

- **WHEN** an admin clears an account's override
- **THEN** the `limits` column is reset and the account reverts to plan-class defaults

#### Scenario: Non-admin cannot set an override

- **WHEN** a non-admin caller attempts to set or read an account override
- **THEN** the request is rejected by admin authorization
