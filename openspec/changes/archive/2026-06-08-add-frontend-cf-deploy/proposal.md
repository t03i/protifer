# Trunk-based frontend deploy on Cloudflare Workers

## Why

The frontend has **no production deploy path at all**. `apps/web` is a pure
static SPA (Vite + TanStack client routing, no SSR), but it has no Dockerfile, it
is absent from `build.yml`'s build matrix, and `infra/Caddyfile.dev` only proxies
API paths — so nothing serves the SPA in prod. Every other artifact ships
trunk-based off `main` (services bump `image-tag.env` in the `doco-cd` deploy
repos, keyed to `github.sha`); the frontend does not. This change closes that gap.

The constraint that shapes the design is **auth cookies**: the better-auth
session cookie is `HttpOnly, Secure, SameSite=Lax`. That makes the registrable
domain — not any platform feature — the deciding factor. Anything on a foreign
apex (`*.pages.dev`, `*.vercel.app`) is cross-site to the API and depends on
third-party-cookie survival. Anything on the **same registrable domain**
(`protifer.app`) is same-site, so the Lax cookie is sent on credentialed XHR and
auth simply works.

Cloudflare is already DNS **and** proxy for `protifer.app`, so traffic already
flows `browser → CF edge → VPS` today. Serving the SPA from a Cloudflare Worker
adds compute at an edge already in the path — not a new network hop — and keeps
the whole frontend on `protifer.app`, where cookies are first-party-clean.

## What Changes

- **The SPA becomes a CI-built Cloudflare Worker (Static Assets), deployed by
  `github.sha`.** `apps/web` builds in CI exactly like the service images, and
  `wrangler deploy` ships the `dist/` output as an immutable, versioned Worker.
  The Worker serves static assets with SPA fallback
  (`not_found_handling = single-page-application`) and **carries no API routing
  logic** — it is pure static (the **B2** topology; see design.md).
- **The API is addressed directly at its own origin, `api.protifer.app`.** The
  browser loads the SPA from `protifer.app` and calls the API at
  `api.protifer.app`. Both are subdomains of the same registrable domain
  (`protifer.app`), so the cross-subdomain request is **same-site** — the
  `SameSite=Lax` session cookie is sent on credentialed requests with no
  cross-site / third-party-cookie exposure, and no cookie `Domain` rewrite. The
  cost is that **CORS applies** — already implemented and unit-tested
  (`buildOriginMatcher`, `CORS_ORIGINS`, the `*`-segment preview matcher in
  `app.cors.test.ts`). No new app code is needed for cross-origin; only config
  values.
- **Frontend and backend co-deploy from one `main` build.** The `build.yml` run
  that bumps the service `image-tag.env`s also `wrangler deploy`s the SPA, both
  keyed to the same `github.sha`. Lockstep is **co-deployment** (loose): one sha
  to reason about, a deploy-straddle window of minutes, no runtime version gate
  (a `/version` reload-nudge is an optional future add, not in scope — see
  Non-goals).
- **Rollback is a single keyed action.** A `workflow_dispatch(sha)` reverts the
  backend `image-tag.env` bump (`doco-cd` reconverges, no touch) **and**
  `wrangler rollback`s the SPA to the matching version. Two mechanisms, one
  operator action, one sha.
- **Config values wire the split origin** (deploy-side; the schema already
  supports every field): `VITE_GATEWAY_URL=https://api.protifer.app`,
  `BETTER_AUTH_BASE_URL=https://api.protifer.app`,
  `CORS_ORIGINS=https://protifer.app` (+ preview wildcard),
  `BETTER_AUTH_TRUSTED_ORIGINS=https://protifer.app`. The GitHub-OAuth redirect
  chain (initiate + callback on `api.`, final redirect to `protifer.app` as a
  trusted origin) is verified, not changed.

## Impact

- Affected specs: `frontend-deployment` (new capability on this branch).
- New surface (monorepo):
  - `apps/web/wrangler.jsonc` (or `.toml`) — Worker name, `assets` binding →
    `dist/`, `not_found_handling = single-page-application`, no routes/proxy code.
  - `.github/workflows/build.yml` — a `deploy-web` job: build `@protifer/web`,
    `wrangler deploy` keyed to `${{ github.sha }}`, gated on `main`, in the same
    run as `bump-deploy-tags`.
  - a `rollback` `workflow_dispatch` (sha input) wrapping the backend
    revert + `wrangler rollback`.
  - optional PR preview deploy (`wrangler versions upload` / preview alias) under
    the already-tested `*.protifer.app`-style preview CORS wildcard.
- Changed config (deploy-side values, schema unchanged): the four env values
  above set for prod.
- Unchanged: dev. `Caddyfile.dev` keeps proxying the out-of-stack FE dev server;
  the split-origin model is a prod concern only.

## Repo boundary (no fleet-private detail in the monorepo)

Mirroring the existing `deploy-{app,state}` split:

- **Monorepo (this change) owns:** the Worker `wrangler` config, the SPA build +
  `wrangler deploy`/`rollback` CI, the gateway CORS/auth **schema** (already
  present), and dev parity. It references the deploy side only abstractly —
  `api.protifer.app`, `protifer.app`, "a Cloudflare Tunnel", a `CLOUDFLARE_API_TOKEN`
  secret — never an account id, zone id, tunnel id, or token value.
- **Deploy side owns (contract, not implemented here):** the `protifer.app` /
  `api.protifer.app` DNS records, the **Cloudflare Tunnel** (`cloudflared` on the
  app-tier host so `api.protifer.app`'s origin has **no public inbound**), the CF
  account/zone, the `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` CI secrets,
  the production env values, and removal of any now-redundant prod Caddy routing
  (CF terminates and routes; the VPS only needs the gateway reachable over the
  Tunnel).

## Non-goals

- **No runtime version-gating / forced reload.** Co-deployment is accepted as
  loose lockstep; the optional `/version` reload-nudge is deferred.
- **No single-origin Worker front-door (the API-proxy topology).** Considered and
  rejected in favor of a direct `api.protifer.app` origin — see design.md
  (alternative B1 / single-origin).
- **No Vercel/Netlify.** Evaluated; rejected — see design.md.
- **No SSR / edge rendering / server components.** The SPA stays a static bundle.
- **No change to the backend deploy mechanism** (`doco-cd` pull-based bump is
  untouched; the frontend deploy is push-based `wrangler` alongside it).
- **No CORS/auth app-code changes** — the cross-origin machinery already exists;
  only config values change.
