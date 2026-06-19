## Context

The shedding admission controller estimates wait time as `pendingResidues / throughput` and sheds requests when that exceeds the per-plan SLO. `pendingResidues` is maintained as a free-running Redis counter (`shedding:pending_residues`): `incrementPending` runs at admission for both `/v1/predictions` and `/v1/embeddings` (`middleware/shedding.ts:195`), and `decrementPending` runs only from live BullMQ `QueueEvents` on the embedding queue, processed by a single elected accounting leader (`event-subscriber.ts:79,109`).

`QueueEvents` is live-only with no replay. Any terminal event not observed by the leader at the instant it fires — leader lock handoff (30s TTL, 10s renew), events outpacing a single leader during a burst, a deduped embedding child (deterministic `jobId`), or a job evicted before `getJob` (`removeOnFail: { count: 100 }`) — drops its decrement permanently. The counter only ratchets up. A 5-minute load test drove it to 400,000 and it stayed dead-flat after load ended, pinning `estimated_wait` at its 5-minute cap. The bug is masked today only because `SHED_MODE` defaults to `shadow`.

The existing cleanup module (`cleanup.ts`) already runs a leader-elected periodic sweep that holds both `predictionQueue` and `embeddingQueue`, exposes a `staleChildrenScan` hook and a `reconcileNow()` handle — the natural home for an authoritative recompute.

The second input, `throughput`, is equally wrong. `recordCompletion(residues, durationSeconds)` (`state.ts:79`) feeds the EWMA a sample of `residues / (finishedOn − processedOn)` per terminal **embedding** event — the processing rate of a single job. The system actually drains `WORKER_CONCURRENCY` (4) jobs per worker across both queues in parallel, so the single-job rate under-states true throughput by roughly the concurrency factor. And it is embedding-only, while reconciled `pending` spans both queues — so `estimated_wait = pending / throughput` divides a both-queue residue total by an embedding-only single-job rate. Fixing the leak alone leaves this dimensional mismatch, so `enforce` would still over-shed. Both inputs must be corrected together.

## Goals / Non-Goals

**Goals:**

- Make `pending_residues` self-healing: a missed event must not leak past the next sweep.
- Derive the authoritative value from real queue state, route-agnostically (fixes the prediction-side blind spot for free).
- Make `throughput` an aggregate, concurrency-aware drain rate in the same residue units as `pending`, so `estimated_wait` is dimensionally meaningful and reflects how fast work actually leaves the queues.
- Derive throughput from reliable signals, not the replay-less event stream, so a missed completion no longer corrupts the estimate.
- Keep admission responsive between sweeps (no regression in decision latency); keep the existing EWMA smoothing and the `decide.ts` formula unchanged — only its inputs change.
- Detect accounting drift via an alert so this class of bug can never again sit invisible.
- Make a future `SHED_MODE=enforce` rollout actually safe (both inputs correct, not just one).

**Non-Goals:**

- Reworking load-testing methodology (honest e2e measurement, rate-limit exemption) — deferred.
- Per-Triton-call / per-job latency metrics (the separate `prediction-latency-observability` change) — not needed for the aggregate residue drain rate here.
- Changing the SLO thresholds, plan priorities, retry-after jitter, or the shadow/enforce default.

## Decisions

### Decision 1: Reconcile on the cleanup leader sweep, not a new loop

Recompute `pending_residues` inside the existing cleanup sweep, next to `staleChildrenScan`. The sweep is already leader-elected (single writer), already holds both queues, and already runs on an interval — so reconciliation inherits correct concurrency semantics with no new lock or timer.

- **Alternative — dedicated reconciliation loop/leader:** rejected; duplicates leader election and risks two writers racing on the same Redis key.
- **Alternative — fix event capture (durable stream / ack):** rejected; turning `QueueEvents` into a replayable log is far more complex and still leaves drift on edge cases. Reconciliation makes correctness independent of event delivery.

### Decision 2: Authoritative recompute = sum of residues over waiting/active/waiting-children

Compute pending as the sum of per-job residues across `QUEUE_NAMES.PREDICTION` and `QUEUE_NAMES.EMBEDDING` for jobs in `waiting`, `active`, and `waiting-children`. Residue per job = sequence length, read from job data (matching how `incrementPending` and the subscriber already derive residues). Write the result with an authoritative setter (`setPending`) — an absolute `SET`, not `incrby`/`decrby`.

- Including `active` keeps in-flight work counted; including `waiting-children` counts prediction parents whose embedding child is still running. Excluding terminal states is what drives the value to zero on drain.
- **Alternative — reconcile only embedding queue:** rejected; that preserves the prediction blind spot.

### Decision 3: Event counter stays as a between-sweeps fast path

Keep `incrementPending`/`decrementPending` so admission reflects sub-sweep-interval activity. Reconciliation overwrites (not adjusts) the value each sweep, so accumulated drift is discarded wholesale. This bounds worst-case staleness to one sweep interval while keeping decisions current.

- **Alternative — remove the event counter, read live each admission:** rejected; summing queue residues on every request is too expensive for the hot path. Sweep-interval reconciliation + cheap incr/decr hint is the right cost balance.

### Decision 4: Leak detector as a metric invariant alert

Add a rule to `infra/monitoring/protifer.rules.yml`: fire when `shedding_pending_residues > 0` is sustained while `bullmq_queue_jobs{state=~"waiting|active"}` is zero. This encodes the invariant "pending must trend to zero when there is no work." `promtool` validates it in CI; `mimirtool rules sync` deploys on `main`.

### Decision 5: Throughput = aggregate drain rate measured on the sweep by conservation

Measure how fast residues actually leave the queues, on the same leader sweep, using flow conservation rather than per-job timing:

```
departures(Δt) = arrivals(Δt) − (pending_now − pending_prev)
drain_rate     = max(0, departures) / Δt_seconds        // residues/sec, aggregate
```

- `arrivals(Δt)` comes from a new **monotonic** `shedding:admitted_residues_total` counter, `INCRBY`-ed synchronously at admission (in both shadow and enforce paths, alongside the existing `incrementPending`). It is reliable because it is in the request path, not the event stream.
- `pending_now` / `pending_prev` are the authoritative reconciled values from Decision 2 (this sweep and the prior one).
- The sweep records `drain_rate` as the EWMA sample (reusing the existing `THROUGHPUT_KEY` Lua update), then snapshots `admitted_total` and the timestamp for the next interval's delta.

This is the same architectural thesis as the pending reconciliation: derive the number from reliable, replay-independent signals. It is automatically **concurrency-aware** (it counts real departures, however many workers/slots produced them) and **route-agnostic** (both queues' work flows through the same pending/arrivals bookkeeping), so it is in the same residue units as `pending` — the division in `decide.ts` becomes dimensionally sound. `decide.ts` itself is unchanged.

- **Alternative — count terminal events into a completed-residues counter and rate it:** rejected as the source — it inherits exactly the replay-less `QueueEvents` fragility (and embedding-only scope) this change exists to escape; a missed completion would understate drain and over-shed.
- **Alternative — multiply the existing single-job rate by a fixed `WORKER_CONCURRENCY × worker_count`:** rejected — the gateway does not know the live worker count, slots are not always full, and it hard-codes a deployment assumption. Measuring real departures needs none of that.
- **Edge cases:** clamp `departures` at ≥ 0 (snapshot timing can make pending momentarily rise mid-drain); skip the EWMA update when `Δt` is ~0 or the prior snapshot is absent (first sweep after boot); `readState` continues to seed `residuesPerSecondEwma` to `config.initialResiduesPerSecond` until the first valid sample, so cold-start behavior is unchanged.

### Decision 6: Retire the per-job throughput sample; subscriber keeps only `decrementPending`

`recordCompletion` is removed from the throughput path — the event subscriber (`event-subscriber.ts:99`) stops calling it, since the per-job, embedding-only sample is exactly the wrong rate. The subscriber retains only `decrementPending` as the between-sweeps fast-path hint (Decision 3). Throughput is now owned entirely by the sweep (Decision 5).

- This keeps a single writer for the EWMA (the leader sweep), mirroring the single-writer property the pending reconciliation relies on, and removes the last place the replay-less event stream fed a decision input.

## Risks / Trade-offs

- **Reconcile reads many jobs under deep backlog** → keep it observe-and-set (no per-job mutation), reuse the existing sweep cadence, and prefer count/aggregate reads; if job-data reads prove heavy, batch them. The sweep already iterates queue state, so marginal cost is bounded.
- **Sub-sweep drift window** → between sweeps the fast-path counter can still be wrong, but it self-corrects each sweep and can no longer leak unboundedly. Acceptable; sweep interval is the staleness bound.
- **Two writers if leadership flaps** → mitigated by reusing the existing single-leader sweep election; the authoritative `SET` is idempotent, so a brief overlap converges rather than corrupts.
- **Alert false negatives if `bullmq_queue_jobs` lags** → the alert uses a sustained `for:` duration so transient drain-vs-counter skew does not fire; tune the window during rollout.
- **Drain-rate noise on short/empty intervals** → a sweep with little traffic yields a tiny, noisy `departures`. Mitigated by the existing EWMA smoothing, clamping `departures ≥ 0`, and skipping the update when `Δt` is ~0; the cold-start floor (`initialResiduesPerSecond`) covers the no-sample window.
- **Sweep cadence couples to estimate freshness** → throughput now updates once per sweep rather than per completion. The EWMA already smooths over multiple samples, so a sweep-cadence sample rate is sufficient for an admission heuristic; if the estimate proves laggy, shorten the sweep, not the design.

## Migration Plan

1. Land reconciliation + `setPending`, the aggregate drain-rate sampler, the admitted-residues counter, and the alert rule behind the existing shadow default (no behavior change for users).
2. Verify on the next real load test that (a) `shedding_pending_residues` returns to zero after load drains, and (b) `shedding_residues_per_second` reflects realistic aggregate throughput (order-of-`WORKER_CONCURRENCY` higher than the old single-job value) so `shedding_estimated_wait_seconds` tracks observed end-to-end latency rather than pinning.
3. Confirm the leak-detector alert is green at idle and does not false-fire under load.
4. Only after (2)–(3) hold is a future `SHED_MODE=enforce` rollout safe — that rollout is a separate operational change.

Rollback: revert the cleanup-sweep reconciliation and drain-rate sampler; restore the `recordCompletion` call in the subscriber. The event-driven counter and per-job throughput resume their prior (leaky, over-estimating) behavior, which is no worse than today's shadow-mode state.

## Open Questions

- Exact reconcile cadence: reuse the cleanup sweep interval as-is, or run reconciliation on a subset of sweeps if job-data reads are costly? Default: reuse as-is, revisit if metrics show cost.
- Idle definition for the alert (`waiting|active` == 0) vs. also requiring `waiting-children` == 0 — confirm against how `bullmq_queue_jobs` labels are exported.
- Drain-rate measurement source — **resolved: conservation (`arrivals − Δpending`)**, per Decision 5. Chosen over a completed-residues event counter because it is fully event-independent and unit-consistent by construction.
