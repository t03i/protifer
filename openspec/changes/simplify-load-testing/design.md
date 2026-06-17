## Context

The load suite has four k6 scripts. Three (`rate-limiter.js`, `throughput.js`, `shedding.js`) stop at the gateway `202`; only `pipeline.js` polls to a terminal state. The compute-path failures (`bound-prediction-fanout`) lived entirely below the line the admission scenarios stop at, which is why the suite reported healthy while prediction jobs failed.

The scripts also act as measurement instruments — they carry `Trend`s/`Counter`s/`len_bucket` tags because the workers emitted no metrics and `/metrics` could not characterize compute. Three drafted changes remove that constraint: `prediction-latency-observability` (per-model + per-job + e2e latency), `fix-shedding-residue-leak` (trustworthy `shedding_residues_per_second`, `admitted_residues_total`), `bound-prediction-fanout` (eliminates the storm, needs a tuning load run). With those, measurement moves to `/metrics` and the scripts become thin generators.

A residual gap surfaced empirically: a load run submitted far more requests than the ~85 embedding jobs that appeared, and nothing reconciles _accepted (202)_ → _enqueued (bullmq)_ → _completed/failed_. With random sequences, dedup collision is ruled out, so the loss is accounting (likely silently-tolerated cap-429s) — invisible because no counter ties the three numbers together.

## Goals / Non-Goals

**Goals:**

- Make the suite measure the layer that actually fails: end-to-end compute, not just admission.
- Reduce four overlapping scripts to two intents on three cadence tiers, sharing one generator.
- Move latency/drain/throughput analysis to `/metrics` + Grafana; keep in k6 only what the server cannot see (client-perceived wall-clock e2e, transport errors, the 429/503 contract shape).
- Make accepted → enqueued → completed reconcilable via a submission counter.
- Keep each tier's cost honest: cheap always-on, expensive on-demand, with the cost stated in-script.

**Non-Goals:**

- Defining the latency/shedding metrics this suite reads — owned by `prediction-latency-observability` and `fix-shedding-residue-leak`.
- Moving prediction to CPU / a separate Triton (isolation/topology, orthogonal).
- Grafana dashboards and new alert rules.
- A staging environment — none exists; prod is the only target, which is precisely why expensive runs stay on-demand.

## Decisions

### Decision 1: Two generators, three cadence tiers — cadence is a dispatch toggle, not a timer

Collapse to `admission.js` (cron), `pipeline.js` (frequent dispatch), `saturate.js` (rare dispatch), all sharing `sequences.js`. The two expensive scenarios are triggered by operator judgment ("this change is big enough"), so they are `workflow_dispatch` toggles with **no schedule**; only the cheap admission guard rides the cron.

```
  always-on  →  weekly cron            admission   rate-limit contract, both plans, cached/no-GPU
  frequent   →  dispatch (judgment)    pipeline    real e2e, VUs ≤ cap, /metrics health
  rare       →  dispatch (judgment)    saturate    over-cap, 503/shedding calibration
```

- **Alternative — keep cadence on schedules (nightly pipeline, weekly saturate):** rejected. Both write permanent prod S3 entries and burn real GPU; their real trigger is a human deciding a change warrants it, which a timer cannot encode. A schedule would either over-run (cost) or under-run (stale).
- **Alternative — one parametrized scenario with an intensity knob:** rejected. `pipeline` wants _under_-cap (never shed, measure throughput) and `saturate` wants _over_-cap (force 503). Opposite sizing goals run at different frequencies for different reasons — collapsing them hides the intent. Shared generator, separate entry points.

### Decision 2: Scripts generate and assert the contract; `/metrics` owns measurement

k6 asserts only what is client-observable — the 429/503 shape, absence of 5xx, and client-perceived submit→complete wall-clock (which the server cannot see). Latency-by-model, drain rate, queue depth, and throughput are read from `/metrics`/Grafana, not reconstructed from k6 `Trend`s.

- `pipeline.js` keeps `e2e_latency` (genuinely client-side) and `submit_latency`, but stops being the window into _which_ model was slow or _how fast the queue drained_ — those are `triton_model_infer_duration_seconds` and `shedding_residues_per_second` now.
- This is the idiomatic split for a push-based Prometheus→Grafana shop: the load tool generates and asserts SLOs; it does not reimplement the metrics pipeline client-side.

### Decision 3: The cron admission guard covers both plans' rate-limit contract, never shedding

`admission.js` asserts free-plan 429 (the existing `rate-limiter.js` behavior) **and** a cached pro-plan submit (no 5xx, correct rate-limit headers/cap behavior). Both run against a cached accession (`P04637`) so they generate ~zero GPU pressure and can run weekly.

- Shedding keys on real residue backlog; a cache hit queues no work, so the 503 path can never trip cheaply. The guard is therefore honestly scoped to the rate-limit contract, and the 503/shedding assertion lives **only** in `saturate.js` (real GPU). The script header states this so the cron is never mistaken for shedding coverage.
- **Alternative — make the cron exercise shedding with a tiny real-inference burst:** rejected. Any real-inference cron run writes permanent prod S3 entries weekly and reintroduces the cost/topology coupling the on-demand tiers exist to avoid.

### Decision 4: Stop fighting the pro concurrent-cap 429 in compute scenarios

Size `pipeline.js` VUs at/under the pro concurrent-job cap so the cap-429 never fires, and treat an unexpected cap-429 as a **mis-sized run** (a check failure), not a tolerated outcome. Remove the `responseCallback` + back-off path that currently absorbs it.

- In a _compute_ scenario, a cap-429 means the run stopped measuring compute and started measuring admission — exactly the conflation that let the suite miss the storm. The 429 assertion belongs in `admission.js` alone.
- **Trade-off:** requires knowing the pro concurrent-cap to size VUs. Until it is known, the script reads it from an env var with a conservative default and documents that hitting 429 means "lower VUs," not "tolerate."

### Decision 5: Delete `throughput.js`

It submits unique sequences (real GPU, permanent S3) yet stops at the `202`. So it is neither the cheap cron guard nor a deep compute run, and its only assertion (`no 5xx`) plus its `submit_latency` are already inside `pipeline.js`. Removing it eliminates a scenario that costs GPU while measuring nothing the others don't.

### Decision 6: Add a submission counter to close the accepted→enqueued→completed gap

Emit a `submissions_total{route,plan}` (or equivalently-labeled) counter at the gateway submission path, alongside the existing `msg:"submission"` log line. Combined with `admitted_residues_total` (from `fix-shedding-residue-leak`) and the `bullmq_*` enqueue/complete metrics, this makes the ~85-vs-expected loss a three-panel Grafana diff instead of a log-grovel.

- **Why a counter, not just the log line:** the log line is per-event and not aggregable in the metrics pipeline; reconciliation needs a rate-able series next to `bullmq_*`.
- **Alternative — infer submissions from `http_requests_total{route,status}`:** rejected as the primary signal. HTTP status counts conflate retries, polls, and non-submission routes; an explicit submission counter is unambiguous and plan-labeled.

## Risks / Trade-offs

- **Reads metrics not yet built** → the compute/shed assertions depend on `prediction-latency-observability` and `fix-shedding-residue-leak`. Mitigation: sequence this change after them; land the admission tier + submission counter (both independent) first.
- **Losing `throughput.js` loses a "max ingest rate" signal** → that signal was never asserted (collect-only) and is better read as gateway request-rate from `/metrics`. Accepted.
- **Cap-sizing fragility in `pipeline.js`** → if the pro cap changes, a fixed VU count silently under- or over-runs. Mitigation: VUs from env with a conservative default; an unexpected 429 fails a check loudly rather than being absorbed.
- **Cron guard gives false confidence** → operators could read a green weekly run as "load is fine." Mitigation: the script header and the capability spec state explicitly that the cron covers only the rate-limit contract, not compute or shedding.
- **Submission counter cardinality** → `{route,plan}` is low-cardinality (2×~3); safe. Avoid per-user or per-sequence labels.

## Migration Plan

1. Land the **independent** pieces first: `submissions_total` counter at the gateway, and `admission.js` (merging `rate-limiter.js` + a cached pro-plan assertion). Update the cron to run `admission.js`; remove the `throughput.js` step. Delete `throughput.js`.
2. After `prediction-latency-observability` and `fix-shedding-residue-leak` are real: finalize `pipeline.js` (drop the cap-429 path, document the `/metrics` reads) and replace `shedding.js` with `saturate.js` (read `shedding_residues_per_second`). Wire both as `workflow_dispatch` toggles.
3. Use `pipeline.js` as the `bound-prediction-fanout` tuning harness: raise `TRITON_MAX_INFLIGHT_INFERS` until Triton is utilized without storms; confirm via `/metrics`.
4. Validate the accounting screw: run `pipeline.js`, confirm `submissions_total` ≈ `bullmq` enqueued ≈ completed (no silent gap), and that any gap is now visible.

Rollback: restore `throughput.js` and the old scenario set; the submission counter is additive and can stay. No user-facing surface changes, so rollback is test-suite-local.

## Open Questions

- **Exact pro concurrent-cap value** for sizing `pipeline.js` VUs — read from env with a conservative default; pin once the plan-limits source (`packages/shared/src/plan.ts`) is confirmed during implementation.
- **`admission.js` structure** — one k6 script with two scenarios (free + pro via `exec`), or keep them as separate VU functions in one file? Default: one file, two scenario functions, to keep the cron a single step.
- **Submission counter label set** — `{route,plan}` is the proposed minimum; confirm whether `outcome` (accepted/shed/rate-limited) is worth adding here or is already covered by `admitted_residues_total` + `requests_shed_total`. Default: `{route,plan}` only, lean on existing counters for outcomes.
