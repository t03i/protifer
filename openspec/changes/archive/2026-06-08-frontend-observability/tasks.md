# Tasks — Frontend observability (Sentry)

> Fresh branch `feat/frontend-sentry` off `main`. Mirrors the backend
> `packages/shared/src/sentry.ts` patterns rather than inventing frontend-
> specific ones. Tier 1 (error capture) + Tier 2 (trace propagation) ship;
> session replay is deferred.

## 0. Prerequisites (launch-blocking — settle before DSN goes live)

- [x] 0.1 Scrub config source of truth = `infra/observability/sentry-pii.json`;
      PR approver = repo owner (single approver). Settled.
- [x] 0.2 Set `VITE_SENTRY_DSN` (as a CI `var`, matching `VITE_GATEWAY_URL`) only
      **after** the scrub config is synced (section 7). Tag events `service: web`
      so they filter against `service:api-gateway` in the one shared project.
- [x] 0.3 Release wiring reused: `deploy-web` tags the Cloudflare version with
      `github.sha`; `notify-sentry-release` tags the same `release`. Frontend
      runtime uses `VITE_GIT_SHA = github.sha`. Settled.
- [x] 0.4 Build/host confirmed in-repo: GitHub Actions `deploy-web` → Cloudflare
      Workers (`wrangler`), main-only; rollback via `rollback-web` by SHA tag.
      Section 6 lands entirely in `deploy-web` + `vite.config`. Settled.

## 1. SDK init (Tier 1)

- [x] 1.1 Add `@sentry/react` to `apps/web/package.json`.
- [x] 1.2 `apps/web/src/lib/sentry.ts` — `initFrontendSentry()`: DSN-gated no-op
      when `VITE_SENTRY_DSN` empty; idempotent guard (HMR-safe); `environment`
      from `import.meta.env.MODE`; `release` from build-time `GIT_SHA` (warn-once
      fallback to `"unknown"`); `sendDefaultPii: false`;
      `initialScope.tags = { service: 'web' }`. Mirror `packages/shared/src/sentry.ts`.
- [x] 1.3 Call `initFrontendSentry()` first thing in `apps/web/src/main.tsx`
      (before `ReactDOM.createRoot`).
- [x] 1.4 Ensure the React tree surfaces render crashes to Sentry while keeping
      `AppErrorBoundary` as the user-facing fallback (`ErrorFallback` + toast).
- [x] 1.5 Set `Sentry.setUser({ id: <opaque sub> })` on auth, clear on logout —
      mirroring the backend `user-context` middleware. Never email/plan/role.

## 2. Logger bridge (Tier 1)

- [x] 2.1 `apps/web/src/lib/logger.ts` — add `SentryLogger`: `error()` →
      `Sentry.captureException(err ?? new Error(msg), { extra: ctx })` + console;
      `info`/`warn` console-only (optionally breadcrumbs).
- [x] 2.2 Swap `SentryLogger` in at boot via `setLogger` (after init), guarded so
      dev/test keep `ConsoleLogger`.
- [x] 2.3 Confirm `AppErrorBoundary.componentDidCatch` reaches Sentry with no
      change to its call site.

## 3. Sequence descriptor (privacy)

- [x] 3.1 `apps/web/src/lib/sequence-descriptor.ts` — Web Crypto SHA-256
      (`crypto.subtle.digest('SHA-256', TextEncoder().encode(seq))`) → lowercase
      hex; `{ sequenceHash, seqLen }` builder.
- [x] 3.2 **Parity test**: byte-identical hex to `computeSequenceHash`
      (`packages/shared/src/hash.ts`) for pinned vectors. Fail loud on drift.
- [x] 3.3 Attach the descriptor (not raw residues) wherever sequence-input errors
      are captured.

## 4. Trace propagation (Tier 2)

- [x] 4.1 Enable `BrowserTracing` with
      `tracePropagationTargets: [VITE_GATEWAY_URL]` so `apiFetch`
      (`apps/web/src/services/api/gateway/client.ts`) and the better-auth client
      send `sentry-trace`/`baggage`. Decide automatic fetch instrumentation vs
      explicit header injection at `apiFetch` (Decision 4).
- [x] 4.2 Verify end-to-end: a submission produces one trace spanning browser →
      gateway → worker in the shared project (gateway `_sentryTrace` continuation
      already exists).

## 5. beforeSend scrub (privacy, Layer 2)

- [x] 5.1 `beforeSend` in `initFrontendSentry()`: strip query strings from URLs
      and known input-field values from request/breadcrumb data.
- [x] 5.2 Ensure breadcrumbs never serialize sequence-input field values.

## 6. Source maps & release (Tier 1 correctness — lands in `deploy-web`)

- [x] 6.1 `build.yml` `deploy-web` → **Build SPA** step: add env
      `VITE_SENTRY_DSN: ${{ vars.VITE_SENTRY_DSN }}` and
      `VITE_GIT_SHA: ${{ github.sha }}`. `initFrontendSentry()` reads both off
      `import.meta.env` (Vite exposes `VITE_`-prefixed vars; no `define` needed).
- [x] 6.2 `apps/web/vite.config.*` — emit prod source maps; add
      `@sentry/vite-plugin` with `release = VITE_GIT_SHA`, org/project/token from
      `SENTRY_*` (already available in `deploy-web`), and
      `filesToDeleteAfterUpload` so `.map` files are stripped **before** `wrangler`
      ships the bundle (Cloudflare never serves maps).
- [x] 6.3 Keep `notify-sentry-release` for commit association; confirm ordering is
      benign (`ignore_missing: true`).

## 7. Repo-owned scrub config + sync (launch-blocking, mirrors `rules-sync`)

- [x] 7.1 `infra/observability/sentry-pii.json` — `relayPiiConfig` with the AA-run
      rule (`[ACDEFGHIKLMNPQRSTVWY]{20,}` → `[Filtered]`) applied to `$string`.
- [x] 7.2 PR job (in `ci.yml`): validate the JSON (jq/schema + relay PII shape),
      analogous to `promtool check rules`.
- [x] 7.3 `main` job (in `build.yml`, alongside `rules-sync`): `sentry-pii-sync` —
      `PATCH /api/0/projects/{org}/{project}/` with `relayPiiConfig` from the file,
      using `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`.
- [x] 7.4 Verify on a test event containing a sequence that the run is redacted at
      ingest. Document "do not edit scrubbing in the UI — overwritten on sync".
- [x] 7.5 Fallback only if 7.3 is impractical for launch: operator checklist in
      the deploy runbook applying the same `sentry-pii.json` by hand.

## 9. Verify (gate before calling done)

- [x] 9.1 `bun run typecheck && bun run lint && bun run format && bun run test`.
- [x] 9.2 DSN-empty run: SDK is a no-op, app behaves identically (dev default).
- [x] 9.3 DSN-set run (no staging env exists — use a manual `wrangler versions
upload` without promote, or the prod version pre-promote): forced render
      error appears in Sentry with a **symbolicated** stack and `service:web`.
- [x] 9.4 Trigger a sequence-input error → event shows `{ sequenceHash, seqLen }`,
      **no raw residues**, and the synced rule scrubs any that leaked.
- [x] 9.5 Distributed trace spans browser→gateway→worker (task 4.2).
- [x] 9.6 `bun run build` — prod bundle builds with maps; check bundle-size delta
      is acceptable.

## Deferred (not this change)

- [ ] D.1 Session replay — post-launch, behind a privacy pass (input masking for
      sequences). Largest PII surface; explicitly out of launch scope.
- [ ] D.2 Possible consolidation of `computeSequenceHash` into an isomorphic
      shared helper (retire the frontend duplicate).
