# Design — Trunk-based frontend deploy on Cloudflare Workers

## The reframe

The hard part of a frontend deploy is never "serve static files" — every
platform does that. It is **where the bytes live relative to the auth cookie**,
and **how rollback stays a single sha**. Cloudflare already fronting `protifer.app`
(DNS + proxy) collapses both: the SPA goes on the same registrable domain the API
already uses, and the Worker is just compute at an edge already in the request
path.

```
                  BEFORE (no FE deploy)              THIS CHANGE (CF Worker, B2)
──────────────────────────────────────────────────────────────────────────────
serve SPA         nothing in prod                    CF Worker Static Assets @ protifer.app
API origin        browser → CF → VPS (api paths)     api.protifer.app → CF → Tunnel → VPS
browser origins   n/a                                protifer.app  +  api.protifer.app
cookie posture    n/a                                same-site (both *.protifer.app) → Lax sent
CORS              n/a                                applies; already built + tested
build             n/a                                CI builds dist/, `wrangler deploy` (= sha)
lockstep          backend only                       co-deployed, one github.sha, same run
rollback          git-revert bump (backend)          workflow_dispatch(sha): revert + wrangler rollback
edge hop cost     CF already in path                 +sub-ms Worker CPU, no new network leg
```

## Decision 1 — Cloudflare Workers, not Vercel/Netlify (SETTLED)

**Decision:** Host the SPA on Cloudflare Workers Static Assets.

- **Cookies decide it, and they tie on domain.** Production must sit on a
  `protifer.app` subdomain regardless of platform — the free platform apexes
  (`*.pages.dev`, `*.vercel.app`) are cross-site to the API and depend on
  third-party-cookie survival. So Vercel/Netlify's headline "git-native preview
  URL" buys nothing in prod here.
- **Lowest new vendor surface.** Cloudflare is already the DNS + proxy. Vercel /
  Netlify add a second SaaS pipeline, dashboard, and auth surface for a static
  bundle we already build in CI.
- **CLI/CI-driven matches the shop.** `wrangler deploy` is scriptable and lives in
  `build.yml` next to the image builds and the `doco-cd` bump — the same "deploy
  is a git/script operation" ethos. Vercel/Netlify are git-pull-opinionated.
- **Instant, immutable rollback.** `wrangler versions` + `wrangler rollback` give
  per-deploy immutable versions — the rollback primitive the lockstep story needs.

## Decision 2 — Split origin (`api.protifer.app`), not a single-origin front-door (SETTLED)

**Decision:** The browser addresses the API **directly** at `api.protifer.app`;
the SPA Worker contains **no API routing**. (User-selected over the single-origin
front-door.)

Two topologies were on the table once CF fronts everything:

```
B2 (CHOSEN) — direct API origin            Single-origin front-door (rejected)
protifer.app      → Worker (static)        protifer.app/*  → Worker
api.protifer.app  → CF → Tunnel → VPS        /v1,/api,... → Origin Rule/Worker → VPS
                                             /*           → static
2 origins, CORS applies (already built)    1 origin, no CORS
Worker = pure static, never in API path    front-door routing is extra config/code
API independently addressable / curl-able  Worker fetch-proxy risks self-route loop
```

- **Why direct origin wins for _this_ request:** the Worker stays trivial (pure
  static, SPA fallback) and is **physically incapable of breaking API
  availability** — the thing that deploys often (frontend) is isolated from the
  thing that must stay up (API). A direct origin is also independently
  addressable for ops (curl, status checks).
- **The cost is CORS, and it is already paid.** `buildOriginMatcher`,
  `CORS_ORIGINS`, `BETTER_AUTH_TRUSTED_ORIGINS`, and the single-segment preview
  wildcard are implemented and unit-tested (`services/api-gateway/src/app.ts`,
  `app.cors.test.ts`). No app code changes — only config values.
- **Cookies are correct without ceremony.** `protifer.app → api.protifer.app` is
  same-site (registrable domain `protifer.app`), so the host-only `SameSite=Lax`
  cookie set by `api.protifer.app` is sent on credentialed XHR from `protifer.app`.
  No `Domain=.protifer.app`, no `crossSubdomainCookies`, no `SameSite=None`.

### Considered alternatives (not chosen)

- **B1 — one Worker serves SPA + proxies the API** (single artifact, atomic
  rollback). Rejected: couples API availability to frontend Worker code, and
  co-deployment already gives a single sha to reason about, so B1's only edge
  (one artifact) buys little for added blast radius.
- **Single-origin front-door via CF Origin Rule** (no Worker proxy code, still one
  browser origin, no CORS). Genuinely clean, but the user prefers an
  independently addressable `api.protifer.app`; with a direct origin there is no
  Origin Rule and the Worker is even simpler.

## Decision 3 — Co-deployment, not runtime version-gating (SETTLED)

**Decision:** Lockstep = both artifacts ship from the same `main` build, keyed to
the same `github.sha`. No runtime gate.

- The `deploy-web` job runs in the same `build.yml` invocation as
  `bump-deploy-tags`; both reference `${{ github.sha }}`.
- Accepted consequence: a **deploy-straddle window** of minutes where an
  edge-cached old SPA may briefly hit a new API (or vice-versa after rollback).
  Mitigated structurally — versioned `/v1` API is backward-compatible within a
  deploy, build-time `openapi`-derived types catch contract drift at build, and
  hashed immutable assets + short HTML TTL shrink the window.
- **Deferred (optional):** a `/version` endpoint + SPA reload-nudge ("new version,
  reload") to cover the straddle window. Cheap; out of scope here.

## Decision 4 — Origin guarded by a Cloudflare Tunnel (deploy-contract, SETTLED)

**Decision:** `api.protifer.app`'s origin is reachable **only** through
Cloudflare, via a `cloudflared` Tunnel on the app-tier host — no public inbound.

- A directly-addressed API origin must not be a CF bypass. The two clean guards
  are a **Tunnel** (no public inbound at all) or **Authenticated Origin Pulls**
  (mTLS so the origin trusts only CF). The Tunnel fits a self-hosted box and the
  `doco-cd` "no exposed ports" posture better.
- **Repo boundary:** the Tunnel (`cloudflared` container, tunnel id, credentials)
  is **deploy-app-owned**. The monorepo references it only as "the origin is
  Tunnel-fronted" and never carries its identifiers. Any now-redundant prod Caddy
  routing is removed on the deploy side (CF terminates and routes).

## Decision 5 — Build in CI, `wrangler deploy` (SETTLED)

**Decision:** CI builds `apps/web` and ships the artifact; CF does not build.

- Keeps the build on our turf, mirroring the service images — one place to reason
  about toolchain, lockfile, and reproducibility.
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are CI secrets in the `deploy`
  environment (deploy-side; not in the repo).
- The alternative — CF Pages/Workers Builds git-connect (git-native rollback UI) —
  was weighed for rollback symmetry but rejected: it moves the build off our
  turf, and `wrangler rollback` already gives immutable per-version rollback.

## Open verification points (resolve during execution)

- **OAuth redirect chain** end-to-end on the split origin: initiate at
  `api.protifer.app`, GitHub callback to `api.protifer.app` (cookie set on a
  top-level navigation — Lax permits), final redirect to `protifer.app` (must be
  in `trustedOrigins`). Confirm with a real login, not just config review.
- **Credentialed CORS preflight**: confirm the gateway returns the specific
  origin (not `*`) with `Access-Control-Allow-Credentials: true` for
  `https://protifer.app`.
- **`wrangler rollback` ↔ backend revert** land on the same sha in one
  `workflow_dispatch` run (rollback dry-run before relying on it).
