## Why

The admission controller's wait estimate — `estimated_wait = pending_residues / throughput`, shed when it exceeds the per-plan SLO — is wrong on **both** of its inputs, and neither alone is safe to enable.

**`pending_residues` leaks permanently.** It is incremented on every submission but decremented only via live BullMQ `QueueEvents` on the embedding queue, handled by a single elected leader — and `QueueEvents` has no replay, so any missed event (leader handoff, events outpacing the leader during a burst, a deduped embedding child, or a job evicted before `getJob`) leaks residues forever. A single 5-minute load test ramped `shedding_pending_residues` to 400,000 where it stayed dead-flat after load ended, pinning `estimated_wait` indefinitely.

**`throughput` is the wrong rate.** It is an EWMA of `residues / (finishedOn − processedOn)` recorded per terminal embedding event (`state.ts:84`, `event-subscriber.ts:99`) — i.e. the processing rate of a **single** job, measured on the **embedding queue only**. The real system drains `WORKER_CONCURRENCY` jobs in parallel per worker across both queues, so this under-states true throughput by roughly the concurrency factor. Worse, after the leak fix `pending_residues` sums residues across **both** queues while `throughput` still reflects embedding-only single-job service — the ratio is dimensionally inconsistent. The estimate over-states wait and would over-shed.

Today both bugs are masked because `SHED_MODE` defaults to `shadow` (requests still admitted). The moment anyone sets `SHED_MODE=enforce`, the gateway returns 503 to all free/pro users — permanently from the leak, and excessively from the throughput error. Fixing the leak alone does **not** make `enforce` safe, because the wait estimate is still wrong. The two fixes are coupled and must land together; this change does both.

## What Changes

**Accounting (`pending_residues`):**

- Add periodic **reconciliation** of `pending_residues` from actual queue state: on the existing cleanup leader sweep, recompute the counter as the sum of residues over jobs currently in `waiting` / `active` / `waiting-children` across the prediction and embedding queues, and write the authoritative value to Redis.
- Make reconciliation the **source of truth**; keep the existing increment/decrement only as a fast-path hint between sweeps. Event drift is now self-healing — a missed event is corrected on the next sweep instead of leaking forever.
- Close the prediction-side blind spot as a side effect: summing real queued work is route-agnostic.

**Estimation (`throughput` / `estimated_wait`):**

- Replace per-job, embedding-only throughput sampling with an **aggregate drain rate** measured on the same leader sweep: residues actually leaving the queues per wall-clock second, in the **same residue units** as `pending_residues`, so the wait estimate is dimensionally consistent and concurrency-aware.
- Derive the drain rate from **reliable signals** (a synchronous monotonic admitted-residues counter and the reconciled pending value), not from the replay-less event stream — a missed completion event no longer corrupts the estimate. The EWMA smoothing is retained for stability; only its input sample changes.
- Stop feeding the per-job `recordCompletion` sample into the throughput EWMA; the event subscriber keeps only its fast-path `decrementPending` role.

**Observability:**

- Add a **leak-detector alert** to `infra/monitoring/protifer.rules.yml`: fire when `shedding_pending_residues` stays above zero while the queues are idle — the invariant that pending must trend to zero when there is no work.

Out of scope (deferred to follow-up changes):

- Load-testing methodology rework (honest end-to-end measurement, rate-limit exemption for pipeline tests).
- Per-Triton-call and per-job latency metrics (the separate `prediction-latency-observability` change). That change improves _human-facing_ latency visibility; it is not required for the aggregate drain-rate estimate here, which needs only residue throughput, not per-model timing.
- Changing the SLO thresholds, plan priorities, retry-after jitter, or the shadow/enforce default.

## Capabilities

### New Capabilities

- `request-shedding`: Admission-control accounting and wait estimation — how `pending_residues` is maintained (event fast-path plus authoritative leader-sweep reconciliation), how `throughput` / `estimated_wait` is derived (aggregate, concurrency-aware drain rate in units consistent with pending), and the observability invariant that detects accounting drift.

### Modified Capabilities

<!-- None — no existing shedding spec; this change introduces the capability. -->

## Impact

- **Code**: `services/api-gateway/src/cleanup.ts` (add reconciliation + drain-rate sampling to the leader sweep, alongside the existing stale-children scan), `services/api-gateway/src/shedding/state.ts` (add an authoritative `setPending`, a monotonic admitted-residues counter, and a sweep-fed throughput sampler; the per-job `recordCompletion` path is removed from the throughput EWMA), `services/api-gateway/src/shedding/event-subscriber.ts` (drops the `recordCompletion` call; keeps `decrementPending` as a hint), `services/api-gateway/src/shedding/decide.ts` (unchanged formula; now fed correct, unit-consistent inputs). Reconciliation reads residues for jobs across `QUEUE_NAMES.PREDICTION` and `QUEUE_NAMES.EMBEDDING`.
- **Redis**: `shedding:pending_residues` becomes a leader-managed derived value; a new monotonic `shedding:admitted_residues_total` feeds the drain-rate computation; `shedding:throughput_ewma` is now driven by the sweep, not per-job events.
- **Monitoring**: new alert rule in `infra/monitoring/protifer.rules.yml` (validated by `promtool` in CI).
- **Behavior**: no user-facing API change. Shadow-mode metrics (`shedding_pending_residues`, `shedding_residues_per_second`, `shedding_estimated_wait_seconds`) become trustworthy, and a future `SHED_MODE=enforce` rollout no longer over-sheds or carries the permanent-503 landmine.
