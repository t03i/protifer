## Context

The prediction worker fans out to multiple models via `Promise.allSettled` in `dispatch.ts`, with a per-adapter `try/catch` that already classifies gRPC errors. The embedding worker makes a single `triton.modelInfer` call in `processor.ts`. Both run as headless BullMQ consumers (`index.ts`) using pino only — no HTTP surface, no `prom-client`. All current metrics are reconstructed at the gateway from BullMQ `QueueEvents`, which only yields whole-job durations and cannot see inside the fan-out or capture client-side call timing.

Triton already exports per-model server-side latency (`nv_inference_*`, labeled `model`), scraped by the app-tier Alloy agent. What's missing is the client's view: network/gRPC overhead, time-to-failure on dropped calls, and the per-prediction fan-out wall-clock. The metrics topology is push-only — Alloy agents scrape per-host targets and remote-write to Grafana Cloud; the agents are hand-owned in `deploy-app` / `deploy-state`.

## Goals / Non-Goals

**Goals:**

- Measure per-model Triton call latency, including time-to-failure, from the client side.
- Measure per-job wall-clock for prediction (fan-out) and embedding jobs.
- Expose worker metrics for scraping in a way that fits the existing push-only Alloy topology.
- Reuse Triton-native per-model metrics rather than duplicating server-side compute timing.
- Give operators per-model and per-job latency for diagnosis (independent of shedding — the estimation fix in `fix-shedding-residue-leak` uses aggregate residue throughput, not this data).

**Non-Goals:**

- Changing shedding decisions, the wait formula, or the throughput EWMA (`decide.ts` / `state.ts` untouched).
- Building Grafana dashboards (live in Grafana Cloud) or new alert rules in this change.
- Editing the deploy-app Alloy config (cross-repo; documented as a handoff).
- Per-S3 / per-decode attribution (would be "full decomposition"; deferred — start with per-model + per-job).

## Decisions

### Decision 1: Instrument at the worker call sites, with a shared metrics module

Define the histograms and the `prom-client` registry once in a shared worker-metrics helper in `@protifer/shared`, imported by both workers so metric names/labels are identical. Time each Triton call at the worker call site:

- Prediction: wrap each adapter call inside the existing `dispatch.ts` `Promise.allSettled` map — start a timer before `triton.modelInfer`, observe on resolve with `status="success"` and in the `catch` with the classified error code as `status`. The per-job timer wraps `dispatchAll` in `processor.ts`.
- Embedding: time the single `modelInfer` in `processor.ts`; the job timer wraps the handler.

- **Alternative — instrument inside `triton-client`:** rejected as the primary seam. The client package shouldn't own a metrics registry (keeps it a thin typed transport), and the per-job fan-out total isn't visible there. A thin optional timing hook on the client is acceptable later but not needed now.

### Decision 2: `status` label carries the outcome, reusing the existing error classification

Use the gRPC error classification already present in `dispatch.ts` (`GRPC_CODE_MAP` → `UNAVAILABLE`, `DEADLINE_EXCEEDED`, etc.) as the `status` value on failure, and `success` otherwise. This makes time-to-failure first-class and lets a "Connection dropped" storm be sliced by `status="UNAVAILABLE"`.

- Keep the label set bounded (the closed code map + `success`) to avoid cardinality blowup. `model` × bounded `status` is safe.

### Decision 3: Minimal HTTP server per worker for `/metrics`

Add a small HTTP listener in each worker's `index.ts` serving `GET /metrics` from the shared registry on a configurable port. Wire its close into the existing SIGTERM drain path (which already drains the queue and closes Triton). Use the same HTTP stack idiom as the gateway where practical to stay consistent.

- **Alternative — pushgateway:** rejected; adds infra and conflicts with the scrape-based topology. **Alternative — gateway reads timings from job return data:** rejected per the failure-capture requirement — failed jobs carry no return value, so drops (the key signal) would be missing.

### Decision 4: End-to-end request latency at the gateway, reusing the flow timestamps

Request latency (user-perceived, includes queue wait) belongs at the gateway, not the worker — the worker only sees its own processing window, not the submission-to-result span. The gateway's `pipeline-metrics.ts` already reconstructs `bullmq_job_total_duration_seconds = finishedOn − timestamp` per queue from `QueueEvents`. For a prediction **flow**, the prediction-parent job is created at submission (`timestamp`), sits in `waiting-children` until the embedding child finishes, then runs the fan-out and completes (`finishedOn`) — so the parent's total already spans **embedding + all models** end-to-end. Embedding request latency is the embedding job's total.

This change validates that mapping with a test and surfaces it explicitly (clear metric naming / labels) so "embedding request latency" and "prediction (emb + all models) request latency" are first-class rather than implicit knowledge about which queue's total means what. Add dedicated `*_request_duration_seconds` histograms only if the existing total cannot be made unambiguous by labeling alone.

- **Alternative — compute request latency in the worker:** rejected; the worker cannot see queue wait or the embedding-child wait, so it would undercount exactly the part the user feels.
- Pairing request latency (gateway) with per-job processing latency (worker) makes queue/wait time attributable by subtraction.

### Decision 5: Config via typed `loadConfig()`, env-wins tunable

Add a metrics section to each worker's config (`METRICS_PORT`, optional `METRICS_ENABLED`) using `configField()` (env-wins, 12-factor tunable). App code reads `config.metrics.port`, never `process.env`.

### Decision 6: Document the scrape contract; Alloy wiring is a deploy-app handoff

The monorepo ships the endpoints + a documented contract (port, path, metric names) in `infra/monitoring/README.md`. Adding the worker targets to the app-tier Alloy agent is a `deploy-app` task, consistent with the established deploy contract (deploy repos hand-own stacks; CI only bumps image tags).

## Risks / Trade-offs

- **Label cardinality** → bound `status` to the closed error-code map + `success`; `model` is a small fixed set. No free-form labels.
- **HTTP server in a headless worker** → keep it tiny and isolated; ensure it never blocks job processing and is closed on drain. Bind to the expected interface for the Alloy agent only.
- **Counters reset on worker restart** → consumers must use `rate()`/`histogram_quantile()` over windows, same convention as the gateway; document in the scrape contract.
- **Cross-repo lag** → until deploy-app adds the scrape targets, metrics are emitted but not collected. Mitigate by landing the contract doc and flagging the handoff explicitly; the endpoints are independently testable via local `curl`.
- **Double-counting vs `nv_*`** → client and server metrics measure different things (client includes transport + failures; server is pure compute). Document the distinction so dashboards don't conflate them.

## Migration Plan

1. Land the shared metrics module, worker instrumentation, `/metrics` endpoints, and config behind the workers (no behavior change to job processing).
2. Verify locally: drive a load run, `curl` each worker's `/metrics`, confirm per-model success + failure histograms and per-job durations populate.
3. Hand off the scrape-target addition to `deploy-app`; once scraped, confirm the series appear in Grafana Cloud.
4. With real per-model/per-job latency flowing, operators can characterize storms (e.g. per-model time-to-failure) that were previously invisible.

Rollback: disable via `METRICS_ENABLED=false` (or revert) — workers fall back to logging-only, no impact on job processing.

## Open Questions

- Reuse the gateway's HTTP stack idiom for the worker `/metrics` server, or a barebones `node:http` listener to keep worker deps minimal? Lean barebones unless the gateway helper is trivially reusable.
- Histogram bucket choice for sub-second per-model calls vs multi-second embedding jobs — likely two bucket sets (fast per-model vs slower per-job). Confirm against observed ranges during verification.
- Should `prediction_job_duration_seconds` carry a `len_bucket` label (sequence-length bucket) for latency-vs-length analysis, or keep it status-only to bound cardinality? Default status-only; revisit if length analysis is needed.
