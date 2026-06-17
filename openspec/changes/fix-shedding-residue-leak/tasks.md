## 1. State: authoritative setter

- [x] 1.1 Add `setPending(residues)` to `shedding/state.ts` that writes `shedding:pending_residues` with an absolute `SET` (clamped at >= 0), distinct from `incrementPending`/`decrementPending`.
- [x] 1.2 Add a unit test in `state.test.ts` proving `setPending` overwrites prior drifted values (not additive).

## 2. Reconciliation on the cleanup leader sweep

- [x] 2.1 Add a residue-summing helper that, given the prediction and embedding queues, sums per-job residues (sequence length) over jobs in `waiting`, `active`, and `waiting-children`.
- [x] 2.2 Wire the helper into the cleanup sweep (`cleanup.ts`) next to `staleChildrenScan`, calling `state.setPending(total)` with the computed sum; pass the `SheddingState` into `CleanupDeps`.
- [x] 2.3 Ensure reconciliation runs only on the leader sweep and is observe-and-set (no per-job mutation); reuse the existing sweep interval.
- [x] 2.4 Add unit tests in `cleanup.test.ts`: (a) drained queues reconcile to zero; (b) a stale/inflated counter is overwritten to the true sum; (c) prediction-flow residues (parent + embedding child) are counted route-agnostically.

## 3. Keep event counter as fast-path hint

- [x] 3.1 Confirm `incrementPending`/`decrementPending` and the embedding-queue subscriber remain unchanged in behavior (now a between-sweeps hint, not source of truth) — no code change expected; add/adjust a comment noting reconciliation is authoritative.
- [x] 3.2 Verify existing `event-subscriber.test.ts` still passes; add a test asserting reconciliation takes precedence over accumulated event drift.

## 4. Estimation: aggregate drain-rate throughput

- [x] 4.1 Add a monotonic `shedding:admitted_residues_total` counter to `state.ts` (`incrAdmitted(residues)` via `INCRBY`); call it synchronously at admission in `middleware/shedding.ts` alongside `incrementPending`, in both the shadow and enforce paths.
- [x] 4.2 Add a sweep-driven throughput sampler to `state.ts`: given the current reconciled `pending`, read+snapshot `admitted_residues_total` and the last sweep timestamp, compute `departures = max(0, arrivals − Δpending)` and `drain_rate = departures / Δt_seconds`, and feed `drain_rate` into the existing `THROUGHPUT_KEY` EWMA Lua update. Skip the update when `Δt ≈ 0` or no prior snapshot exists.
- [x] 4.3 Wire the sampler into the cleanup leader sweep so it runs right after reconciliation (same sweep, using the just-computed pending as `pending_now`).
- [x] 4.4 Remove the `recordCompletion` call from `event-subscriber.ts` (keep `decrementPending`); drop or repurpose the now-unused per-job `recordCompletion` from `state.ts`.
- [x] 4.5 Unit tests in `state.test.ts`: (a) drain rate reflects concurrent departures (arrivals − Δpending), not single-job time; (b) clamps negative departures to zero; (c) skips update with no prior snapshot / zero Δt; (d) cold start still falls back to `initialResiduesPerSecond`.
- [x] 4.6 Test in `cleanup.test.ts`/`event-subscriber.test.ts` that a missed terminal event does not affect throughput (it is sweep-derived), and `decide.ts` is unchanged and consumes the new inputs.

## 5. Leak-detector alert

- [x] 5.1 Add an alert rule to `infra/monitoring/protifer.rules.yml` firing when `shedding_pending_residues > 0` is sustained (`for:` window) while `bullmq_queue_jobs{state=~"waiting|active"}` is zero.
- [x] 5.2 Confirm the rule passes `promtool` validation (the CI gate) and add it to any rules unit-test fixtures if present.

## 6. Verification

- [x] 6.1 Run repo gates: `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`.
- [x] 6.2 Run shedding/cleanup integration coverage via `bun run test:int` (stack up) to exercise reconciliation and drain-rate sampling against real Redis/queues.
- [ ] 6.3 Manual/load verification: confirm `shedding_pending_residues` returns to zero after a load test drains; `shedding_residues_per_second` reflects realistic aggregate throughput (order-of-`WORKER_CONCURRENCY` above the old single-job value); `shedding_estimated_wait_seconds` tracks observed latency rather than pinning; and the leak-detector alert is green at idle without false-firing under load.
