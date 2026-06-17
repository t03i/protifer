## ADDED Requirements

### Requirement: Triton fan-out concurrency is bounded per worker

The prediction worker SHALL limit the number of concurrent in-flight Triton `modelInfer` calls it issues. The limit SHALL be enforced across all jobs processed concurrently by the worker process (a single shared bound), not per individual job, so that `WORKER_CONCURRENCY` jobs cannot collectively exceed the configured number of simultaneous gRPC streams. A permit SHALL be acquired before each `modelInfer` call and released on every completion path, including errors and timeouts, so the bound cannot be leaked.

#### Scenario: Worker-wide streams stay within the bound under parallel jobs

- **WHEN** multiple prediction jobs run concurrently and each fans out to all adapters
- **THEN** the number of `modelInfer` calls in flight across the whole worker at any instant does not exceed the configured concurrency limit, and excess calls wait for a permit rather than opening immediately

#### Scenario: A failed call does not leak its permit

- **WHEN** a `modelInfer` call throws (transport error, timeout, or decode failure)
- **THEN** its concurrency permit is released, so the worker's available concurrency returns to its prior level and is not permanently reduced

### Requirement: Fan-out concurrency limit is configurable

The concurrency limit SHALL be exposed as a typed configuration tunable read through the worker's `loadConfig()` (env-wins), with a safe default. Application code SHALL read it from typed config, never from `process.env` directly. The default SHALL be conservative relative to Triton's single-instance serving capacity so that the system fails toward under-utilization rather than transport saturation.

#### Scenario: Operator tunes the limit without a code change

- **WHEN** the limit's environment variable is set to a different value at worker start
- **THEN** the worker enforces that value as its in-flight `modelInfer` bound, with no code change required

### Requirement: Transient Triton transport errors are retried within the bound

A `modelInfer` call SHALL retry on transient transport failures — connection drops (`UNAVAILABLE`) and transport-level saturation/parse errors (the `Bandwidth exhausted` / `Failed parsing HTTP/2` class) — using a bounded number of attempts with jittered backoff. Retries SHALL NOT be issued for deterministic failures (`INVALID_ARGUMENT`, `NOT_FOUND`) or for deadline expiry (`DEADLINE_EXCEEDED`). A retried call SHALL hold its concurrency permit across attempts, so retrying never widens worker-wide concurrency beyond the bound.

#### Scenario: A single connection drop does not fail the fan-out

- **WHEN** one `modelInfer` call fails with a transient connection drop while the others succeed
- **THEN** that call is retried within its existing permit and, if a retry succeeds, the adapter's output is produced rather than recorded as a model failure

#### Scenario: Deterministic errors are not retried

- **WHEN** a `modelInfer` call fails with `INVALID_ARGUMENT` or `NOT_FOUND`
- **THEN** the call fails immediately without retry and is attributed as that model's error

#### Scenario: Retries stay within the concurrency bound

- **WHEN** calls are being retried under load
- **THEN** the total number of concurrent in-flight `modelInfer` calls (original attempts plus in-progress retries) still does not exceed the configured concurrency limit

### Requirement: Triton channel is configured to survive sustained, bursty load

The Triton gRPC client SHALL configure connection keepalive so that a connection idle between bursts is kept healthy and a half-open connection is detected rather than surfacing as a mid-call transport parse error. Keepalive settings SHALL be conservative enough not to trip Triton's server-side keepalive enforcement.

#### Scenario: Idle-then-bursty connection remains usable

- **WHEN** a worker is idle for a period and then issues a burst of `modelInfer` calls on the same connection
- **THEN** the calls proceed on a healthy connection rather than failing with a transport-layer connection error on first use

### Requirement: Concurrency limit is tuned against observed Triton capacity

The shipped default concurrency limit SHALL be treated as a conservative starting point, not the final value. A load run SHALL be used to tune the limit upward until Triton is well-utilized without reintroducing the transport-saturation storm, and the chosen value with its rationale SHALL be recorded in the operator runbook so the setting is reproducible and not a buried magic number. Tuning SHALL be observable: the load run SHALL confirm the absence of `Connection dropped` / `Bandwidth exhausted or memory limit exceeded` errors and non-idle Triton utilization at the selected limit.

#### Scenario: Limit is raised until Triton is utilized without storms

- **WHEN** a load run is executed at the default limit and shows Triton under-utilized
- **THEN** the limit is increased and re-run, and the value selected is the highest that keeps the run free of `Connection dropped` / `Bandwidth exhausted or memory limit exceeded` errors while keeping Triton busy

#### Scenario: Selected limit is recorded for reproducibility

- **WHEN** a tuned concurrency limit is chosen from a load run
- **THEN** the value and the rationale (observed capacity, error/utilization evidence) are documented in the operator runbook, not left as an undocumented default override
