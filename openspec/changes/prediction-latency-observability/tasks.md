## 1. Shared worker-metrics module

- [x] 1.1 Add `prom-client` to the workers; create a shared worker-metrics helper in `@protifer/shared` exporting a registry and the histograms: `triton_model_infer_duration_seconds{model,status}`, `prediction_job_duration_seconds{status}`, `embedding_job_duration_seconds{status}`.
- [x] 1.2 Define bounded label sets (`status` = closed gRPC error-code map + `success`); pick bucket sets (fast per-model vs slower per-job).
- [x] 1.3 Add a tiny `/metrics` HTTP server helper (configurable port) over the shared registry.
- [x] 1.4 Unit-test the module: histograms registered with expected names/labels; `/metrics` serves Prometheus text.

## 2. Prediction worker instrumentation

- [x] 2.1 Time each adapter's Triton call inside the `dispatch.ts` `Promise.allSettled` map; observe `triton_model_infer_duration_seconds` with `status="success"` on resolve and the classified error code on `catch` (failure-path latency).
- [x] 2.2 Time the full fan-out per job (wrap `dispatchAll` in `processor.ts`); observe `prediction_job_duration_seconds` with success/failure status.
- [x] 2.3 Start the `/metrics` server in `index.ts` from typed config; wire its close into the SIGTERM drain path.
- [x] 2.4 Tests: per-model success + failure observations recorded; per-job duration recorded on both paths; all-models-failed still yields per-model failure timings.

## 3. Embedding worker instrumentation

- [x] 3.1 Time the single `modelInfer` call in `processor.ts`; observe `triton_model_infer_duration_seconds` (success + failure).
- [x] 3.2 Time the job (wrap the handler); observe `embedding_job_duration_seconds`.
- [x] 3.3 Start the `/metrics` server in `index.ts` from typed config; wire close into SIGTERM drain.
- [x] 3.4 Tests: success and failure timings recorded; metrics endpoint served.

## 4. Worker config

- [x] 4.1 Add a metrics section (`METRICS_PORT`, optional `METRICS_ENABLED`) to each worker's typed `loadConfig()` via `configField()` (env-wins); read through `config.metrics.*`, never `process.env`.

## 5. End-to-end request latency (gateway)

- [x] 5.1 In `pipeline-metrics.ts`, verify the prediction-parent flow total spans embedding child wait + fan-out (add a test on the flow timestamps); confirm embedding job total = embedding request latency.
- [x] 5.2 Surface both explicitly: embedding request latency and prediction (emb + all models) request latency — via clear labeling on `bullmq_job_total_duration_seconds`, or dedicated `*_request_duration_seconds` histograms if labeling is ambiguous.
- [x] 5.3 Test: prediction request latency includes time spent in `waiting-children`; request latency vs worker processing latency makes queue wait attributable by subtraction.

## 6. Scrape contract documentation

- [x] 6.1 Document the worker `/metrics` scrape contract (port, path, metric names, `rate()`/`histogram_quantile()` usage) in `infra/monitoring/README.md`, flagged as a `deploy-app` Alloy follow-up handoff.

## 7. Verification

- [x] 7.1 Run repo gates: `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`, `bun run build`.
- [x] 7.2 Local end-to-end: run a load pass, `curl` each worker `/metrics`, confirm per-model (success + failure), per-job, and gateway request-latency series populate with sensible values.
- [x] 7.3 Confirm graceful shutdown closes the metrics server without disrupting queue drain.
