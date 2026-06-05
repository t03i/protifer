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
