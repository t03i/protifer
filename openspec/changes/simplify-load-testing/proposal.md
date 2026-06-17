## Why

The load suite measures the wrong layer. Four scenarios exist (`rate-limiter.js`, `throughput.js`, `shedding.js`, `pipeline.js`), but three of the four stop at the gateway `202` and never touch the compute path — so the suite stayed green while the prediction workers were saturating Triton and failing every job (`All prediction models failed — Connection dropped`). The failure lives below the line every admission scenario stops at.

The scripts also conflate generation with measurement. Each carries `Trend`s, `Counter`s, and `len_bucket` tagging because `/metrics` could not previously report what happened _inside_ the system, so the k6 script became the only window. Three drafted changes close that gap from the server side:

- `prediction-latency-observability` adds `triton_model_infer_duration_seconds{model,status}`, `prediction_job_duration_seconds`, and gateway end-to-end request latency.
- `fix-shedding-residue-leak` makes `shedding_residues_per_second` a trustworthy aggregate drain rate and adds the monotonic `admitted_residues_total` arrivals counter.
- `bound-prediction-fanout` eliminates the storm and explicitly _requires_ a tuning load run to raise `TRITON_MAX_INFLIGHT_INFERS` to Triton's real capacity.

Once those land, the measurement belongs in `/metrics` + Grafana, and the load scripts collapse to load **generators** that assert only the client-observable contract. This change also surfaces a residual observability gap: a load run that submits N requests yields fewer enqueued jobs than expected (observed ~85 embedding jobs vs. submitted), and nothing reconciles _accepted → enqueued → completed_, so the loss is invisible.

## What Changes

- **Collapse four scenarios into two intents on three cadence tiers**, sharing the existing `sequences.js` generator:
  - `admission.js` — **weekly cron**, cached/cheap (no GPU). Asserts the rate-limit contract for **both** free and pro plans (429 fires, carries rate-limit headers, no 5xx). Explicitly does **not** cover shedding (a cache hit queues no work, so 503 can never trip cheaply).
  - `pipeline.js` — **on-demand dispatch (frequent)**. Real end-to-end submit→complete, VUs sized **at/under** the pro concurrent-cap so the cap-429 never fires; worker/Triton health read from `/metrics`, not reconstructed in-script. Doubles as the `bound-prediction-fanout` tuning harness.
  - `saturate.js` — **on-demand dispatch (rare)**, run only on shedding-algorithm or load-method changes. Drives over-cap, tolerates 503, reads `shedding_residues_per_second` for EWMA calibration. The **only** 503/shedding coverage.
- **Delete `throughput.js`** — it burns real GPU on unique sequences (so it is not the cheap cron guard) yet stops at the 202 (so it is not a deep compute run). It falls between every tier; its one assertion (`no 5xx`) and its `submit_latency` are already covered inside `pipeline.js`.
- **Stop fighting the pro concurrent-cap 429** in compute scenarios. Size VUs ≤ cap so it never fires, and treat an unexpected cap-429 as a mis-sized run, not a tolerated outcome. The 429 assertion belongs in exactly one place: `admission.js`.
- **Close the accounting gap** with a gateway **submission counter metric** (`submissions_total{route,plan}` or equivalent — a metric, not only the existing `msg:"submission"` log line), so `submissions_total` → `bullmq` enqueued → completed/failed is a Grafana diff. Pairs with `admitted_residues_total` to explain where accepted work disappears.

Out of scope (separate concerns / changes):

- The metrics this suite _reads_ — added by `prediction-latency-observability`, `fix-shedding-residue-leak`. This change consumes them; it does not define them. The submission counter is the one metric added here because it is a load-accounting instrument, not a latency/shedding input.
- Moving prediction to CPU / a separate Triton — an isolation/topology decision, orthogonal to load-testing methodology.
- Grafana dashboards (built in Grafana Cloud, not repo-managed) and new alert rules.
- The shedding-estimation and fan-out fixes themselves.

## Capabilities

### New Capabilities

- `load-testing`: The load suite is two generators on three cadence tiers — a cheap always-on admission guard (rate-limit contract, both plans, no GPU), a frequent on-demand end-to-end pipeline run (real compute, VUs under the cap, health read from `/metrics`), and a rare on-demand saturation run (over-cap, the only shedding/503 coverage) — plus a submission counter that makes accepted→enqueued→completed reconcilable.

## Impact

- **Tests**: `tests/load/admission.js` (new — merges `rate-limiter.js` with a cached pro-plan rate-limit assertion), `tests/load/pipeline.js` (keep; drop the cap-429 back-off path, size VUs ≤ cap, document the `/metrics` reads), `tests/load/saturate.js` (rename/replace `shedding.js`; read the now-trustworthy `shedding_residues_per_second`), `tests/load/sequences.js` (shared generator, unchanged). **Delete** `tests/load/throughput.js`.
- **CI**: `.github/workflows/nightly.yml` — cron runs `admission.js` only; `pipeline` and `saturate` are `workflow_dispatch` toggles (no schedule). Remove the `throughput` step.
- **Code**: gateway emits a `submissions_total` counter in `services/api-gateway/src/metrics.ts` + submission path, alongside the existing submission log line.
- **No user-facing change.** The suite stops reporting green while compute is on fire, and the accepted→enqueued→completed gap becomes observable.
- **Sequencing**: the compute and shedding assertions read metrics added by the other three changes, so this lands _after_ them (or its compute/shed assertions do); the admission tier and the submission counter are independent and can land first.
