## Why

We have no visibility into how long individual predictions actually take. The workers emit zero metrics, so the only latency signal is `bullmq_job_total_duration_seconds{queue}` reconstructed at the gateway — a single opaque number that blends queue wait, embedding inference, the 8-head prediction fan-out, S3 I/O, and decode. We cannot answer "how long does a prediction take," let alone "which model is slow" or "how long did a call run before it dropped." That blind spot is exactly what hid the recent "all prediction models failed — Connection dropped" storm: an idle GPU while jobs failed, with no client-side latency or per-model failure timing to characterize it.

## What Changes

- Add **client-observed latency metrics** emitted by the prediction and embedding workers (new — workers currently emit none):
  - `triton_model_infer_duration_seconds{model, status}` — per Triton call, labeled by model and outcome, **including time-to-failure** so dropped/timed-out calls are measured, not just successes.
  - `prediction_job_duration_seconds{status}` — wall-clock of the 8-head fan-out per prediction job.
  - `embedding_job_duration_seconds{status}` — wall-clock per embedding job.
- Add **end-to-end request latency** (the user-perceived time, including queue wait), measured at the gateway from the flow's timestamps:
  - embedding request latency (submission → embedding result), and
  - prediction request latency for **embedding + all models** (submission → final prediction result, i.e. the full flow incl. the embedding prerequisite and the fan-out).
    These reuse the gateway's existing `QueueEvents`/`pipeline-metrics` path (the prediction-parent flow total already spans embedding + fan-out); the change verifies that mapping and surfaces it as explicit request-latency metrics rather than leaving it implicit in `bullmq_job_total_duration_seconds`.
- Each worker exposes a `prom-client` **`/metrics` endpoint** (workers are currently BullMQ consumers with no HTTP surface). A Grafana Alloy agent scrapes them and remote-writes to Grafana Cloud, matching the existing push-only topology.
- **Reuse** Triton's existing per-model server-side metrics (`nv_inference_compute_infer_duration_us`, `nv_inference_queue_duration_us`, `nv_inference_request_duration_us`, labeled by `model` — already scraped) for the server-side compute breakdown; the new client-side metrics cover what Triton cannot see (network/gRPC overhead, connection drops, and the per-prediction fan-out total).
- Add worker config for the metrics endpoint (port/enable) via the typed `loadConfig()` per worker.
- Document the **scrape contract** (port, path) for the deploy-app Alloy agent.

Out of scope (deferred):

- Fixing the shedding wait-time / throughput estimation model — handled in `fix-shedding-residue-leak` (which uses an aggregate residue drain rate, not per-model latency, so it does not depend on this change). This change is human-facing latency visibility, not a shedding input.
- The `fix-shedding-residue-leak` accounting + estimation change (separate, independent).
- Load-testing methodology rework.
- Grafana dashboards (built in Grafana Cloud, not repo-managed) and new alert rules — visibility first; alerting can follow once baselines exist.

## Capabilities

### New Capabilities

- `prediction-latency-observability`: Per-model and per-job inference latency emitted by the workers (successes and failures), end-to-end request latency for embedding and for the full prediction flow (embedding + all models) measured at the gateway, and the reuse of Triton-native per-model server-side latency.

### Modified Capabilities

<!-- None — no existing worker-metrics spec; this introduces the capability. -->

## Impact

- **Code**: `services/prediction-worker/` (time the per-adapter fan-out in `dispatch.ts`, the per-job wall-clock in `processor.ts`, add a metrics HTTP server in `index.ts`), `services/embedding-worker/` (time the Triton call + per-job wall-clock, add metrics server), `services/*/src/config*.ts` (metrics endpoint config). A shared worker-metrics helper (registry + histograms + server) in `@protifer/shared` so both workers register identical metric names/labels. Instrumentation must record on both the success and failure paths (e.g. the `Promise.allSettled` catch in `dispatch.ts`).
- **Gateway**: `services/api-gateway/src/pipeline-metrics.ts` / `metrics.ts` — surface end-to-end request latency for embedding and for the full prediction flow (emb + all models), validating that the prediction-parent flow total faithfully spans the embedding child wait plus the fan-out (reuse `bullmq_job_total_duration_seconds` or add dedicated request-latency histograms if the flow mapping needs to be explicit).
- **Dependencies**: `prom-client` added to the workers (already used by the gateway).
- **Infra / cross-repo**: new Alloy scrape targets in `deploy-app` (hand-owned) for the worker `/metrics` endpoints — a documented follow-up handoff, not a monorepo edit. Scrape contract documented in `infra/monitoring/README.md`.
- **Ops**: workers gain an HTTP port; SIGTERM drain path must also close the metrics server.
- **No user-facing API change.** Gives operators real per-model and per-job latency for diagnosis (e.g. characterizing the "Connection dropped" storm); it is independent of the shedding estimation fix, which uses aggregate residue throughput.
