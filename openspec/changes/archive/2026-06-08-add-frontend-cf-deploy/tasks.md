# Tasks — Trunk-based frontend deploy on Cloudflare Workers

> Fresh capability. Topology **B2** (direct `api.protifer.app` origin; pure-static
> Worker). Cross-origin app code already exists and is unit-tested — these tasks
> add the Worker, the CI build/deploy/rollback, and set config values; they do
> **not** write new CORS/auth code.

## 1. Worker + wrangler config (monorepo)

- [x] 1.1 Add `apps/web/wrangler.jsonc` — Worker name `protifer-web`, `assets`
      binding → `./dist`, `not_found_handling = "single-page-application"`, no
      routes/proxy logic. `compatibility_date` pinned.
- [x] 1.2 Confirm `bun run --filter @protifer/web build` emits `dist/` with hashed
      assets + `index.html` (Vite default); no SSR/worker entry needed for pure
      static serving.
- [x] 1.3 `bun run typecheck` / `lint` / `format` clean with the new config file.

## 2. CI build + co-deploy (build.yml)

- [x] 2.1 Add a `deploy-web` job to `.github/workflows/build.yml`: checkout, Bun
      setup, `bun install`, `bun run --filter @protifer/web build`.
- [x] 2.2 `wrangler deploy` the built `dist/` keyed to `${{ github.sha }}` (version
      message/tag = sha), gated on `github.ref == refs/heads/main`, `environment:
deploy`. Runs in the same invocation as `bump-deploy-tags` (co-deployment).
- [x] 2.3 Wire `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` from the `deploy`
      environment secrets (deploy-side; documented in the deploy contract, not
      committed).
- [x] 2.4 Respect existing `paths-ignore` (docs/planning/md) so non-web commits
      don't churn a redundant FE deploy where avoidable.

## 3. Split-origin config values (deploy-side; verify schema, set values)

- [x] 3.1 Confirm the gateway schema already accepts: `CORS_ORIGINS`,
      `BETTER_AUTH_BASE_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` (it does — no schema
      change expected; flag if any field is missing).
- [x] 3.2 Production values (deploy-side): `VITE_GATEWAY_URL=https://api.protifer.app`
      (build-time for the SPA), `BETTER_AUTH_BASE_URL=https://api.protifer.app`,
      `CORS_ORIGINS=https://protifer.app` (+ preview wildcard),
      `BETTER_AUTH_TRUSTED_ORIGINS=https://protifer.app`.
      Monorepo wires the build-time `VITE_GATEWAY_URL` in the `deploy-web` build
      step; the three gateway runtime values are deploy-side env (handoff — §6).
- [x] 3.3 Ensure `VITE_GATEWAY_URL` is available at **build time** in the
      `deploy-web` job (Vite inlines `import.meta.env` at build).

## 4. Rollback (monorepo workflow)

- [x] 4.1 Add a `rollback` `workflow_dispatch(sha)`: (a) revert the backend
      `image-tag.env` bump for that sha in the deploy repo(s) (or repin to it),
      (b) `wrangler rollback` the SPA to the matching version. One action, one sha.
- [ ] 4.2 Dry-run `wrangler rollback` / `wrangler versions list` to confirm the
      sha→version mapping is recoverable before relying on it.

## 5. Preview deploys (optional)

> **Deferred — dropped from this change.** A per-PR preview is not sensible
> without a backend the preview origin can exercise: a `*.workers.dev` preview URL
> is not in the gateway CORS allowlist, so auth/credentialed flows fail against the
> prod API, and there is no preview backend to target. Revisit if/when a
> preview-reachable origin under the registrable domain is provisioned deploy-side.

- [ ] 5.1 On PRs, `wrangler versions upload` (preview alias) and confirm the
      preview URL is matched by the existing single-segment CORS wildcard so auth
      works against the prod (or a preview) API.
- [ ] 5.2 Decide preview API target (prod `api.` vs ephemeral) and document it; do
      not point previews at prod mutating endpoints without intent.

## 6. Deploy-side contract (NOT implemented in monorepo — handoff)

- [ ] 6.1 DNS: `protifer.app` → Worker (route/custom domain); `api.protifer.app` →
      CF-proxied origin.
- [ ] 6.2 Cloudflare **Tunnel** (`cloudflared` on app-tier host) so
      `api.protifer.app`'s origin has no public inbound; remove now-redundant prod
      Caddy routing (CF terminates + routes).
- [ ] 6.3 Provision `CLOUDFLARE_API_TOKEN` (scoped: Workers Scripts edit) +
      `CLOUDFLARE_ACCOUNT_ID` as `deploy` env secrets.

## 7. Verification (before calling done)

- [ ] 7.1 Real GitHub-OAuth login end-to-end on the split origin: initiate at
      `api.protifer.app`, callback sets cookie, redirect lands on `protifer.app`,
      authenticated XHR from `protifer.app` carries the cookie (Network tab shows
      `Cookie:` sent, 200 not 401).
- [ ] 7.2 Credentialed CORS preflight returns the specific origin +
      `Access-Control-Allow-Credentials: true` for `https://protifer.app`.
- [ ] 7.3 Co-deploy: one `main` push lands both the SPA version and the backend
      bump at the same sha.
- [ ] 7.4 Rollback: `workflow_dispatch(prev_sha)` reverts backend and rolls the
      SPA back to the matching version; site serves the prior bundle, API serves
      the prior images.
- [ ] 7.5 SPA deep-link (e.g. `/predictions/<id>`) cold-loads via SPA fallback
      (not a 404).

> **Remaining (live access required — not checkable from the monorepo):** 4.2
> (`wrangler versions list` dry-run against the live account), §6 (deploy-side:
> DNS/Tunnel/secrets — owned by the deploy repos, intentionally not in the
> monorepo), and §7 (post-deploy verification against the live split origin).
> The monorepo provides the mechanisms these steps exercise: 4.2's sha→version
> mapping is the `--tag $sha` upload + tag-matched `versions list` lookup in
> `rollback.yml`; §7.3/7.4/7.5 are realized by `deploy-web`/`rollback.yml` and
> `not_found_handling: single-page-application`.
