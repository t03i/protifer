# Alert rules — GitOps flow

The monorepo owns the alert **rules**; everything operator-facing (metrics
catalog, Alloy + Grafana Cloud topology, rule catalog, delivery config) lives
in the deploy repos' READMEs — the app-tier runbook in `deploy-app`
(triton + api-gateway scrape) and the state-tier `deploy-state` (garage
scrape). Each host runs its own Alloy agent; there is no cross-host scrape.

[`protifer.rules.yml`](protifer.rules.yml) is the Prometheus-format source of
truth. It contains **no fleet-private detail** (metric names + thresholds
only), so it lives here alongside the code that emits the metrics — a metric
rename and its rule update land in the same PR.

```
PR  → promtool validates protifer.rules.yml (monitoring-rules CI job)
main→ mimirtool rules sync --namespaces protifer → Grafana Cloud Mimir ruler
```

- `monitoring-rules` job: `promtool check rules` on every push/PR.
- `rules-sync` job: main-only; its only credential is the rules-scoped
  Grafana token in GitHub Actions secrets — low blast radius.
- **Do not edit rules in the Grafana UI** — UI edits drift from the repo and
  are overwritten on the next sync.

[`dashboards/`](dashboards/) holds the starter dashboard JSON — import via
Grafana Cloud → Dashboards → New → Import.

## Worker `/metrics` scrape contract

Each worker (`prediction-worker`, `embedding-worker`) exposes `GET /metrics`
in Prometheus text format on `METRICS_PORT` (default `9090`), toggled by
`METRICS_ENABLED`. The monorepo ships these endpoints and this contract only;
wiring the worker targets into the app-tier Alloy agent's scrape config is a
**`deploy-app` follow-up handoff** — the deploy repos hand-own scrape config.

Exposed metrics:

- `triton_model_infer_duration_seconds{model,status}` — client-observed
  per-call latency, including time-to-failure; `status` is `success` or the
  gRPC error class.
- `prediction_job_duration_seconds{status}` — per prediction job.
- `embedding_job_duration_seconds{status}` — per embedding job.

These are **client-side** measurements: they include transport time and
failed calls. Do not conflate them with Triton's **server-side**
`nv_inference_*` metrics, which measure pure compute on successful inferences
only. Use both to attribute latency between the network/queue and the GPU.

Counters and histograms reset on worker restart — query with `rate()` and
`histogram_quantile()` over a window, not as absolute values.
