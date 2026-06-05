# k6 Load Tests

These scripts are [k6](https://grafana.com/docs/k6/latest/) load tests for the protifer API Gateway.
They run via the k6 **Go binary** — not the `k6` npm package (which is a 9-year-old dummy stub with no real k6 functionality).

## Why there is no package.json here

The `tests/load/` directory intentionally has **no `package.json`**. Adding one would:

1. Register this directory as a Bun workspace package (root `package.json` has `"workspaces": ["tests/*"]`)
2. Risk pulling in the `k6` npm package (a dummy stub) instead of the real Go binary
3. Create build artifacts (node_modules, lockfile entries) that are irrelevant to k6 scripts

**DO NOT add a package.json here.** k6 scripts are plain JavaScript run exclusively by the k6 Go binary.

## Scripts

| Script            | Purpose                                                       | Plan    |
| ----------------- | ------------------------------------------------------------- | ------- |
| `rate-limiter.js` | Free-plan rate limiter enforcement (20 VUs, 30s)              | LOAD-02 |
| `throughput.js`   | Pro-plan throughput baseline (5 VUs, 3 minutes, collect-only) | LOAD-03 |

## Required Environment Variables

| Variable                | Used by           | Description                                                                                  |
| ----------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| `PROD_GATEWAY_URL`      | Both scripts      | Full base URL of the API Gateway (e.g. `https://api.example.com` or `http://localhost:3001`) |
| `LOAD_TEST_FREE_BEARER` | `rate-limiter.js` | API key for a free-plan user (triggers rate limiting at 10 req/min)                          |
| `LOAD_TEST_PRO_BEARER`  | `throughput.js`   | API key for a pro-plan user (60 req/min limit)                                               |

Keys are consumed via `__ENV` (k6's environment variable mechanism) and are never logged or committed.
Both scripts read keys from the shell environment only — they contain no hardcoded credentials.

## Local Run Commands

Install k6 first:

```bash
# macOS
brew install k6

# Other platforms: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

Run the rate-limiter enforcement test (expects 429 responses):

```bash
k6 run \
  -e PROD_GATEWAY_URL=http://localhost:3001 \
  -e LOAD_TEST_FREE_BEARER=<your-free-plan-key> \
  tests/load/rate-limiter.js
```

Run the throughput baseline (collect-only, no pass/fail thresholds on latency):

```bash
k6 run \
  -e PROD_GATEWAY_URL=http://localhost:3001 \
  -e LOAD_TEST_PRO_BEARER=<your-pro-plan-key> \
  tests/load/throughput.js
```

To capture baseline metrics as JSON:

```bash
k6 run \
  -e PROD_GATEWAY_URL=http://localhost:3001 \
  -e LOAD_TEST_PRO_BEARER=<your-pro-plan-key> \
  --out json=throughput-baseline.json \
  tests/load/throughput.js
```

## CI Entrypoint

The nightly CI workflow (`.github/workflows/nightly.yml`, from Phase 11 Plan 03) runs both scripts
automatically. That is the authoritative gate for production load behavior.

## Thresholds

**rate-limiter.js:**

- `rate_limited_count > 0` — the free-plan cap MUST be hit (confirms rate limiter is active)
- `fivexx_count == 0` — no server errors allowed

**throughput.js:**

- `http_req_failed < 0.01` — less than 1% network errors or 5xx responses

No latency or request-rate thresholds are set in `throughput.js` — baseline capture only.

## Header Notes

k6 lowercases all response header names. When checking for `RateLimit` (draft-7 combined header),
use `r.headers['Ratelimit']` in k6 check functions.
