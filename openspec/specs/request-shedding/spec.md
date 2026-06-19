# request-shedding Specification

## Purpose

Gateway-side admission control that protects the prediction and embedding
pipelines from overload. The controller tracks how much queued work (`pending_residues`)
is in flight and estimates wait time so it can return 503 + Retry-After under a
class-based SLO. This capability governs how `pending_residues` accounting stays
truthful — reconciled from live queue state rather than drifting on missed
events — and how the wait estimate is computed from an aggregate, concurrency-aware
throughput in consistent residue units across both pipelines.

## Requirements

### Requirement: Pending residues reconciled from queue state

The admission controller's `pending_residues` accounting SHALL be derived from the actual queue state, not solely from an event-driven increment/decrement counter. The accounting leader SHALL periodically recompute `pending_residues` as the sum of residues over all jobs currently in the `waiting`, `active`, and `waiting-children` states across the prediction and embedding queues, and SHALL write that computed value as the authoritative `shedding:pending_residues` in Redis. Reconciliation SHALL run on the existing cleanup leader sweep.

#### Scenario: Counter self-heals after a missed completion event

- **WHEN** a job terminates but its completion event is missed by the accounting subscriber (e.g. leader handoff, event burst, deduped child, or evicted job), leaving `pending_residues` higher than the real queued work
- **THEN** the next leader-sweep reconciliation recomputes `pending_residues` from the live queue state and overwrites the stale value, so the leak does not persist across sweeps

#### Scenario: Counter returns to zero when the system drains

- **WHEN** all prediction and embedding queues have no jobs in `waiting`, `active`, or `waiting-children`
- **THEN** the next reconciliation sets `pending_residues` to zero

#### Scenario: Prediction-flow residues are accounted route-agnostically

- **WHEN** prediction jobs and their embedding children are queued
- **THEN** reconciliation includes their residues regardless of which queue emits completion events, so prediction-side work is not undercounted

### Requirement: Event-driven counter is a fast-path hint

The system SHALL retain the existing `incrementPending` (at admission) and `decrementPending` (on terminal events) operations as a between-sweeps fast path so admission decisions reflect recent activity without waiting for the next reconciliation. These operations SHALL NOT be the source of truth; the leader-sweep reconciliation value SHALL take precedence whenever it runs.

#### Scenario: Admission reflects recent submissions before the next sweep

- **WHEN** a request is admitted and its residues are added via `incrementPending`
- **THEN** subsequent admission decisions before the next reconciliation account for those residues

#### Scenario: Reconciliation overwrites accumulated event drift

- **WHEN** the event-driven counter has drifted from the true queued residues between sweeps
- **THEN** the reconciliation pass replaces the drifted value rather than adjusting it incrementally

### Requirement: Accounting drift is observable

The monitoring rules SHALL include an alert that detects a stuck `pending_residues` counter. The alert SHALL fire when `shedding_pending_residues` remains above zero for a sustained period while the queues are idle (no `waiting` or `active` jobs), indicating accounting drift that reconciliation has not cleared. The alert rule SHALL pass `promtool` validation.

#### Scenario: Leak detector fires on a stuck counter

- **WHEN** `shedding_pending_residues` stays above zero for the configured duration while no jobs are `waiting` or `active`
- **THEN** the leak-detector alert fires

#### Scenario: No false alarm under genuine load

- **WHEN** `shedding_pending_residues` is above zero because jobs are genuinely `waiting` or `active`
- **THEN** the leak-detector alert does not fire

### Requirement: Wait estimate uses an aggregate, concurrency-aware throughput

The throughput used in the wait estimate (`estimated_wait = pending / throughput`) SHALL represent the aggregate rate at which residues actually leave the queues across all workers and processing slots — not the processing rate of a single job. A single job's service time SHALL NOT be used directly as the system throughput.

#### Scenario: Throughput reflects concurrent draining, not one job

- **WHEN** multiple jobs are processed concurrently across worker slots
- **THEN** the recorded throughput reflects the combined rate at which residues drain from the queues, so the wait estimate is not inflated by the concurrency factor

#### Scenario: Throughput tracks observed drain after a load test

- **WHEN** a load test drives sustained traffic and then drains
- **THEN** the recorded residues-per-second reflects the realistic aggregate drain rate and `estimated_wait` tracks observed end-to-end latency rather than pinning at an inflated value

### Requirement: Wait estimate inputs share consistent residue units

The `pending` and `throughput` inputs to the wait estimate SHALL be expressed in the same residue units and SHALL both account for work across the prediction and embedding queues, so that `estimated_wait` is dimensionally meaningful. Throughput SHALL NOT be derived from a single queue while pending spans both.

#### Scenario: Both pipelines contribute to throughput

- **WHEN** both prediction-flow and embedding work are draining
- **THEN** the measured throughput accounts for residues leaving both queues, matching the both-queue residue total used for `pending`

### Requirement: Throughput is robust to missed completion events

The throughput measurement SHALL be derived from signals that do not depend on observing every BullMQ terminal event (which has no replay), so a missed completion event does not corrupt the wait estimate. The measurement SHALL be performed by the accounting leader.

#### Scenario: Throughput is unaffected by a missed terminal event

- **WHEN** a terminal completion event is missed by the accounting subscriber
- **THEN** the throughput value used for admission is still computed correctly from reliable accounting (e.g. reconciled pending and synchronously-counted admissions), not understated by the missed event
