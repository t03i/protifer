## ADDED Requirements

### Requirement: Load scenarios are organized by intent across three cadence tiers

The load suite SHALL consist of exactly two generation intents — an admission-contract guard and an end-to-end compute run — sharing one sequence generator, organized across three cadence tiers: a cheap always-on tier on a schedule, and two expensive on-demand tiers triggered by operator dispatch. Cadence for the expensive tiers SHALL be a dispatch toggle, not a schedule, because their trigger is operator judgment that a change warrants the cost.

#### Scenario: Only the cheap admission guard is scheduled

- **WHEN** the scheduled (cron) load workflow runs
- **THEN** it runs only the admission guard, which generates no real GPU inference (cached inputs), and the end-to-end and saturation scenarios are not scheduled — they are available only via manual dispatch toggles

#### Scenario: Expensive scenarios run on demand

- **WHEN** an operator wants an end-to-end or saturation run
- **THEN** it is triggered by a `workflow_dispatch` toggle, and the scenario header states its cost (real GPU inference and permanent prod object-store entries)

### Requirement: The admission guard asserts the rate-limit contract for both plans and not shedding

The admission guard SHALL assert the client-observable rate-limit contract for both the free and pro plans using cached inputs so it generates no real inference. It SHALL assert that the free-plan cap returns 429 with a rate-limit header and that pro-plan submissions return no 5xx with correct rate-limit headers. It SHALL NOT claim to cover shedding: because a cached input enqueues no work, the 503 shed path cannot trip, and the scenario SHALL document that shedding coverage lives only in the saturation run.

#### Scenario: Free-plan rate limit fires under the cheap guard

- **WHEN** the admission guard drives the free plan above its per-minute cap with cached inputs
- **THEN** the gateway returns 429 carrying a rate-limit header, and no 5xx occurs

#### Scenario: Pro-plan cached submissions stay healthy

- **WHEN** the admission guard submits cached pro-plan requests
- **THEN** responses are non-5xx and carry the expected rate-limit headers, with no real inference triggered

#### Scenario: The guard does not assert shedding

- **WHEN** the admission guard completes
- **THEN** it makes no 503/shedding assertion, and its header documents that shedding is covered only by the saturation scenario

### Requirement: The end-to-end scenario measures real compute below the admission cap

The end-to-end scenario SHALL submit unique sequences and poll each job to a terminal state, measuring client-perceived submit→complete latency. It SHALL be sized at or under the pro-plan concurrent-job cap so the concurrent-cap 429 does not fire; an unexpected concurrent-cap 429 SHALL be treated as a mis-sized run (a failed check), not a tolerated outcome. Worker and Triton health SHALL be read from the metrics endpoint, not reconstructed from client-side timings.

#### Scenario: VUs stay under the cap so the cap-429 never fires

- **WHEN** the end-to-end scenario runs at its configured concurrency
- **THEN** the in-flight job count stays at or under the pro concurrent-job cap, and a concurrent-cap 429 is recorded as an unexpected (failed) result rather than absorbed

#### Scenario: Compute health is read from metrics, not the script

- **WHEN** an operator characterizes per-model latency or queue drain for a run
- **THEN** they read it from the metrics endpoint (`triton_model_infer_duration_seconds`, `shedding_residues_per_second`, queue depth), and the script reports only client-perceived end-to-end and submit latency

### Requirement: The saturation scenario is the only shedding/503 coverage

The saturation scenario SHALL drive submissions above sustainable throughput with mixed sequence lengths, tolerate 503 responses during the ramp, and read `shedding_residues_per_second` for steady-state calibration of the shedding EWMA. It SHALL be the sole scenario that exercises the 503 shed path, and SHALL run on demand only.

Because shedding defaults to shadow mode (`SHED_MODE=shadow`), the run SHALL ensure enforce mode is active before asserting the shed path — by setting the `shedding.enforce` flag override (effective within the flag cache window, no restart) — and SHALL revert it on completion. Under sustained over-cap load in enforce mode the run SHALL observe at least one `503` carrying `Retry-After`; a run that produces no `503` SHALL fail rather than pass, so a shadow-mode no-op is never mistaken for shedding coverage.

#### Scenario: Over-cap load surfaces shedding for calibration

- **WHEN** the saturation scenario sustains over-cap load with enforce mode active
- **THEN** 503 responses are tolerated (not counted as failures) and carry `Retry-After`, real network errors still fail the run, and `shedding_residues_per_second` is readable for calibration during the steady-state window

#### Scenario: A run that never sheds fails

- **WHEN** the saturation run completes without observing any 503 under sustained over-cap enforce-mode load
- **THEN** the run fails, signalling either that enforce was not active or that the load did not exceed the resolved SLO

### Requirement: Shedding enforcement is runtime-configurable without restart

The shedding control plane SHALL be togglable at runtime: the `shedding.enabled` and `shedding.enforce` flag overrides take effect within the flag cache window with no redeploy, and an account's shed threshold SHALL be the per-account resolved `sloSeconds` (from the `user.limits` override) overlaid on the plan-class default, not a static per-plan constant. The saturation run SHALL exercise this surface: enabling enforce engages shedding and disabling it resumes admission.

#### Scenario: Enforce toggle engages and disengages shedding

- **WHEN** an operator flips `shedding.enforce` on and then off around a saturation run
- **THEN** over-cap submissions shed (503) while enforce is on and resume admitting (202) within the flag cache window after it is turned off

#### Scenario: Per-account SLO override sets the shed threshold

- **WHEN** the saturation account carries a `sloSeconds` override in `user.limits`
- **THEN** shedding for that account trips against the override value, allowing a deterministic saturation threshold without changing global config

### Requirement: Submission accounting is reconcilable end to end

The gateway SHALL expose a submission counter metric labeled by route and plan, incremented on the submission path alongside the existing submission log line, so that accepted submissions, enqueued jobs, and completed/failed jobs can be reconciled from metrics. The label set SHALL stay low-cardinality (no per-user or per-sequence labels).

#### Scenario: Accepted-versus-enqueued loss is visible

- **WHEN** a load run submits more requests than the number of jobs that appear enqueued
- **THEN** the discrepancy is visible by comparing the submission counter against the BullMQ enqueue/complete metrics, rather than requiring log inspection

### Requirement: The suite contains no scenario that costs GPU without measuring compute

The suite SHALL NOT contain a scenario that submits unique (uncached) sequences yet stops at the gateway acceptance without polling to a terminal state. Any scenario that incurs real inference cost SHALL measure the compute path it pays for.

#### Scenario: No collect-only scenario burns real inference

- **WHEN** the suite is inventoried
- **THEN** every scenario that submits uncached sequences polls jobs to a terminal state, and there is no real-inference scenario that stops at the 202
