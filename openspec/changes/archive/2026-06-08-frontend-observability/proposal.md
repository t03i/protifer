# Frontend observability (Sentry)

## Why

The backend is fully instrumented — `@sentry/node` across `packages/shared`,
`services/api-gateway`, and `packages/worker-bootstrap`, with `requestId` /
`traceId` / `spanId` on every log line, `X-Request-Id` echoed, and workers
continuing spans via `_sentryTrace` on the job data. **The browser is the one
blind spot.**

- `AppErrorBoundary.componentDidCatch` (`apps/web/src/components/error/AppErrorBoundary.tsx`)
  logs to a swappable `logger` whose production implementation is `ConsoleLogger`
  (`apps/web/src/lib/logger.ts:27`) — i.e. **render crashes vanish into the
  browser console** with nowhere to land. Unhandled promise rejections and
  chunk-load failures are not captured at all.
- The frontend's single fetch wrapper (`apps/web/src/services/api/gateway/client.ts`)
  sends **no `sentry-trace` / `baggage` headers**, so every distributed trace
  begins at the gateway. The backend already built the _receiving_ half of
  frontend→backend tracing (`_sentryTrace` continuation); **that investment is
  currently half-realized** — a trace can never reach back to the user action
  that caused it.

Launch is imminent and pre-launch, so this is the moment to close the blind spot
before real users hit errors we can't see.

Two constraints shape the design:

1. **Protein sequences are sensitive — "loggable but scrub-quickly."** They aid
   debugging of sequence-input bugs, so a blanket block is wrong; but raw
   residues must not sit in Sentry. The backend already solved this: its
   submission event (`SubmissionLogPayload`, `packages/shared/src/correlation.ts:36`)
   carries `{ sequenceHash, seqLen, … }` and **never the raw sequence**. The
   frontend adopts the identical descriptor.
2. **The Sentry project is shared with the backend (chosen for convenience).**
   That couples the backend's PII-minimal posture to the frontend's leakiest
   event, and the project currently has **no server-side data scrubbing at all** —
   today the posture is code-discipline-only. Adding the browser (the noisiest
   event source) is exactly when discipline-only stops being adequate, so a
   project-level scrub rule becomes a prerequisite of turning the frontend on.

## What Changes

- **A DSN-gated `@sentry/react` init at the web entry point.** A browser analog
  of `packages/shared/src/sentry.ts`: when `VITE_SENTRY_DSN` is empty the SDK
  runs in no-op mode (the default for dev/test); when set it initialises before
  `ReactDOM.createRoot` in `apps/web/src/main.tsx`. `environment` from the build
  mode, `release` from a build-time `GIT_SHA`, `sendDefaultPii: false`, and a
  `service: web` tag mirroring the backend's `initialScope.tags.service`. Events
  are filterable as `service:web` vs `service:api-gateway` in the one shared
  project.
- **A `SentryLogger` wired through the existing `setLogger()` seam.** No new
  plumbing: `AppErrorBoundary` and any caller already log via the `Logger`
  interface (`apps/web/src/lib/logger.ts`). The production logger forwards
  `error()` to `Sentry.captureException` while keeping console output. Render
  crashes stop dying silently.
- **A privacy-safe sequence descriptor, reusing the backend identity.** Error
  context attaches `{ sequenceHash, seqLen }` — never the residues. Because
  `packages/shared/src/hash.ts` imports node `crypto` (not browser-safe), the
  frontend gets a small Web Crypto helper that produces the **identical SHA-256
  hex** as `computeSequenceHash`, so the hash is the same join key the backend
  logs and Garage uses as its cache key (`emb/{model}/{ver}/{sequenceHash}`). One
  id stitches a browser error → the submission log line → the cached artifact.
- **Trace propagation on the single fetch chokepoint.** `BrowserTracing` with
  `tracePropagationTargets` scoped to `VITE_GATEWAY_URL` so `apiFetch`
  (`client.ts:9`) attaches `sentry-trace`/`baggage`. The gateway already honours
  the inbound trace and continues the span into workers; the shared project means
  the full click→gateway→worker trace **renders end-to-end in one view**.
- **A `beforeSend` browser-side scrub.** Strips query strings and known input
  field values before an event leaves the browser, mirroring the backend's
  `defaultPinoOptions()` redaction discipline.
- **A repo-owned server-side Advanced Data Scrubbing config, synced by CI
  (launch-blocking).** Mirroring the alert-rules GitOps
  (`infra/monitoring/protifer.rules.yml` → `mimirtool rules sync` in
  `build.yml`), the project's `relayPiiConfig` lives in-repo as
  `infra/observability/sentry-pii.json` — a regex net over long amino-acid runs
  (`[ACDEFGHIKLMNPQRSTVWY]{20,}` → `[Filtered]`). PR validates the JSON; `main`
  syncs it to the shared project via the Sentry API
  (`PATCH /projects/{org}/{project}/`) using the **already-present**
  `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` secrets. It catches sequence
  leaks regardless of which service emitted them — converting the project from
  discipline-only to defense-in-depth and **retroactively protecting the backend
  too** (today a thrown error whose message embedded a sequence would ship
  unscrubbed via `Sentry.captureException(err)`, `app.ts:597`). If API sync proves
  fiddly, the fallback is an operator checklist in the deploy runbook; the in-repo
  JSON stays the source of truth either way.

## Impact

- Affected specs: `frontend-observability` (new capability).
- New / reworked code (monorepo):
  - `apps/web/package.json` — add `@sentry/react`.
  - `apps/web/src/lib/sentry.ts` (new) — DSN-gated `initFrontendSentry()`,
    idempotent, `beforeSend` scrub, browser-tracing config.
  - `apps/web/src/main.tsx` — call init first thing; ensure the React tree is
    wrapped so render crashes reach Sentry (keep `AppErrorBoundary` as the user-
    facing fallback).
  - `apps/web/src/lib/logger.ts` — add a `SentryLogger` implementation; swap it
    in at boot via `setLogger`.
  - `apps/web/src/lib/sequence-descriptor.ts` (new) — Web Crypto SHA-256 helper +
    `{ sequenceHash, seqLen }` builder, parity-tested against
    `computeSequenceHash`.
  - `apps/web/src/services/api/gateway/client.ts` — covered by
    `tracePropagationTargets` (no per-call header code if the SDK fetch
    instrumentation is enabled; otherwise explicit header injection at `apiFetch`).
  - `apps/web/vite.config.*` — emit prod source maps; `@sentry/vite-plugin` to
    upload them to the `github.sha` release and strip `.map` from the deployed
    bundle (so Cloudflare never serves them).
  - `infra/observability/sentry-pii.json` (new) — repo-owned `relayPiiConfig`.
  - `.github/workflows/build.yml` `deploy-web` job — inject `VITE_SENTRY_DSN`
    (from `vars`) and `VITE_GIT_SHA: ${{ github.sha }}` into the **Build SPA**
    step, and add the source-map upload (Sentry secrets already available — the
    job is `environment: deploy`). `release = github.sha`, the same id the
    Cloudflare version is tagged with (`wrangler versions upload --tag`) and the
    backend images / `notify-sentry-release` already use.
  - `.github/workflows/build.yml` `sentry-pii-sync` job + `.github/workflows/ci.yml`
    PR validation — the scrub-config GitOps mirroring `rules-sync` / `promtool`.
- Build/host is **confirmed in-repo**: GitHub Actions `deploy-web` builds the SPA
  and ships it to Cloudflare Workers via `wrangler` (main-only), tagged by
  `github.sha`; `rollback.yml` `rollback-web` rolls back by the same tag. No
  deploy-side contract needed — the source-map + DSN wiring lands entirely in
  `deploy-web`.
- Deferred (not in this change): **session replay** — the largest PII surface;
  masking sequence inputs properly is a post-launch privacy pass, not pre-launch
  work.

## Repo / ownership boundary

- **Monorepo (this change) owns:** the client SDK init, the `SentryLogger`, the
  descriptor helper, the fetch-propagation wiring, Vite source-map config, and
  the CI source-map upload step. It references the Sentry project only abstractly
  via `VITE_SENTRY_DSN` — no DSN, org, or auth token committed.
- **Monorepo additionally owns the data-scrubbing config as code:**
  `infra/observability/sentry-pii.json` is the source of truth for the project's
  `relayPiiConfig`, validated on PR and synced to the shared project by CI on
  `main` (the alert-rules model). The config must be synced **before**
  `VITE_SENTRY_DSN` is populated in any environment with real sequences.
- **Sentry project settings own only what cannot be code (contract):** member
  access and event retention. The scrub _lever_ is now in-repo; the **fallback**
  if API sync is impractical is an operator checklist in the deploy runbook, with
  the in-repo JSON still the canonical definition.

## Non-goals

- **No session replay** — deferred behind a post-launch privacy review.
- **No new logging backend** — Sentry attaches to the existing `setLogger` seam;
  no change to the `Logger` interface contract.
- **No PII expansion** — only `{ sequenceHash, seqLen }` and the opaque
  better-auth `sub` (via `Sentry.setUser({ id })`, matching the backend) enter
  events; never email/plan/role, never raw sequences.
- **No bespoke trace format** — reuse the SDK's `sentry-trace`/`baggage`
  propagation the gateway already consumes; do not invent headers.
- **No change to the backend Sentry init** — `packages/shared/src/sentry.ts` is
  the mirrored reference, untouched.
