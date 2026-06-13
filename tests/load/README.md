# k6 Load Tests

These scripts are [k6](https://grafana.com/docs/k6/latest/) load tests for the protifer API Gateway.
They run via the k6 **Go binary** — not the `k6` npm package (which is a 9-year-old dummy stub with no real k6 functionality).

## Operating model: load runs against production

protifer has **no staging environment**, so these tests run against **production**. That makes
discipline non-negotiable — the load shares the gateway, Redis, queues, and GPU with real users.
The rules below keep the blast radius small:

- **Dedicated test users.** `LOAD_TEST_FREE_BEARER` / `LOAD_TEST_PRO_BEARER` must belong to
  throwaway free/pro accounts created solely for load testing — never a real user's key. This keeps
  real users' quotas and accounting clean and lets you distinguish test traffic.
- **Off-peak only.** The scheduled run is Monday 02:00 UTC. Trigger manual runs off-peak too.
- **Read the real metrics in Grafana.** Because production is already scraped by the Alloy agents,
  your existing dashboards show the real server-side effect of each run (HTTP latency histograms,
  `bullmq_*` queue depth/wait/processing, `requests_shed_total`, Triton failure rate, GPU util).
  Locate the run by its time window (scheduled = Mon 02:00 UTC; manual = the dispatch timestamp).
  k6's own client-side view (VUs, client-observed percentiles, iterations) stays in the CI JSON
  artifacts — see "Reading results" below.
- **Shedding posture.** With load on prod, admission control should be in **`SHED_MODE=enforce`**
  (set in the `deploy-app` repo) so the controller sheds the _test_ under contention and drains
  paying tiers first. In `shadow` mode it observes only and will not protect real users. This is an
  operator decision owned in the deploy repo, not here.

## Why there is no package.json here

The `tests/load/` directory intentionally has **no `package.json`**. Adding one would:

1. Register this directory as a Bun workspace package (root `package.json` has `"workspaces": ["tests/*"]`)
2. Risk pulling in the `k6` npm package (a dummy stub) instead of the real Go binary
3. Create build artifacts (node_modules, lockfile entries) that are irrelevant to k6 scripts

**DO NOT add a package.json here.** k6 scripts are plain JavaScript run exclusively by the k6 Go binary.
Shared helpers live in `sequences.js` and are imported with a relative path (k6 resolves these natively).

## Scripts

| Script            | Purpose                                                                      | Cadence                     |
| ----------------- | ---------------------------------------------------------------------------- | --------------------------- |
| `rate-limiter.js` | Free-plan rate limiter enforcement (20 VUs, 30s); gateway-bound, mostly 429s | Weekly (scheduled)          |
| `throughput.js`   | Pro-plan throughput baseline (5 VUs, 3 min, collect-only); real inference    | Weekly (scheduled)          |
| `shedding.js`     | Admission-controller EWMA calibration (15 VUs, ~6 min); creates GPU pressure | **On-demand only** (manual) |

### Cache fidelity (important)

Prediction/embedding results are stored **hash-keyed and immutable** in S3. A _fixed_ input is
therefore a permanent cache hit after its first run, so it would measure the cache path — not real
Triton inference. To produce a real signal:

- `throughput.js` and `shedding.js` submit a **unique random amino-acid sequence per request**
  (`sequences.js → randomSequence`), guaranteeing a cache miss every time.
- `throughput.js` keeps the sequence **length fixed** (`LOAD_TEST_SEQ_LENGTH`, default 350) so the
  per-run compute cost stays comparable for run-over-run trending, while the residues vary.
- The price of a real signal is **real recurring GPU cost** every run. For a cheap gateway-only run
  (no inference), set `LOAD_TEST_CACHED=true` on `throughput.js` to reuse a fixed cached accession.

## Required Environment Variables

| Variable                | Used by                        | Description                                                                        |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `PROD_GATEWAY_URL`      | all scripts                    | Full base URL of the API Gateway (e.g. `https://api.example.com`)                  |
| `LOAD_TEST_FREE_BEARER` | `rate-limiter.js`              | API key for a dedicated free-plan test user (triggers rate limiting at 10 req/min) |
| `LOAD_TEST_PRO_BEARER`  | `throughput.js`, `shedding.js` | API key for a dedicated pro-plan test user                                         |
| `LOAD_TEST_SEQ_LENGTH`  | `throughput.js` (optional)     | Fixed sequence length for the baseline (default `350`)                             |
| `LOAD_TEST_CACHED`      | `throughput.js` (optional)     | `true` → cheap gateway-only run on a fixed cached accession (no inference)         |

Keys are consumed via `__ENV` (k6's environment variable mechanism) and are never logged or committed.
All scripts read keys from the shell environment only — they contain no hardcoded credentials.

In CI these are GitHub Actions **secrets** of the same name (`PROD_GATEWAY_URL`,
`LOAD_TEST_FREE_BEARER`, `LOAD_TEST_PRO_BEARER`). If they are unset, the scripts fail fast in
`setup()` — which is exactly what an unconfigured nightly run looks like.

## Local Run Commands

Install k6 first:

```bash
# macOS
brew install k6

# Other platforms: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

Rate-limiter enforcement (expects 429 responses):

```bash
k6 run \
  -e PROD_GATEWAY_URL=http://localhost:3001 \
  -e LOAD_TEST_FREE_BEARER=<free-plan-key> \
  tests/load/rate-limiter.js
```

Throughput baseline (real inference; capture JSON for trending):

```bash
k6 run \
  -e PROD_GATEWAY_URL=http://localhost:3001 \
  -e LOAD_TEST_PRO_BEARER=<pro-plan-key> \
  --out json=throughput-baseline.json \
  tests/load/throughput.js
```

Shedding calibration (on-demand; watch the live metrics while it runs):

```bash
k6 run -e PROD_GATEWAY_URL=http://localhost:3001 -e LOAD_TEST_PRO_BEARER=<pro-plan-key> \
  tests/load/shedding.js
# in another shell:
watch -n 5 'curl -s http://localhost:3001/metrics | grep -E "^shedding_|^requests_shed_total"'
```

After the shedding run, read `shedding_residues_per_second` during the steady-state window and set
`SHED_INITIAL_RESIDUES_PER_SECOND` to ~70–80% of the observed value.

Add `K6_SMOKE=true` to any script to bypass the credential guard for syntax-only validation.

## CI Entrypoint

`.github/workflows/nightly.yml`:

- **Schedule (Mon 02:00 UTC):** `rate-limiter.js` + `throughput.js`.
- **Manual (`workflow_dispatch`):** same two, plus `shedding.js` when the **`include_shedding`**
  input is checked. Shedding is never scheduled because it deliberately drives the admission
  controller into shedding.

## Reading results

- **Server-side (the real metrics):** your existing Grafana Cloud dashboards, filtered to the run's
  time window. This is the highest-signal view — it shows what the system actually did under load.
- **Client-side (k6's own view):** each run uploads `k6-*-summary.json` as a GitHub Actions artifact
  (30-day retention). Download and inspect for VU counts, client-observed latency, and iteration rate.

## Thresholds

**rate-limiter.js:**

- `rate_limited_count > 0` — the free-plan cap MUST be hit (confirms rate limiter is active)
- `fivexx_count == 0` — no server errors allowed

**throughput.js:**

- `http_req_failed < 0.01` — less than 1% network errors or 5xx responses

No latency or request-rate thresholds are set in `throughput.js` — baseline capture only.

**shedding.js:**

- `http_req_failed < 0.05` — tolerate 503s (that's the point); fail only on real network errors.

## Header Notes

k6 lowercases all response header names. When checking for `RateLimit` (draft-7 combined header),
use `r.headers['Ratelimit']` in k6 check functions.
