# Design — Frontend observability (Sentry)

## The reframe

"Add error tracking to the frontend" undersells it. The backend already built a
vendor-neutral observability spine — trace ids on every log line, `X-Request-Id`
echo, `_sentryTrace` span continuation into BullMQ workers. The frontend is the
_missing first hop_. So this change is less "bolt on a new tool" and more
"complete a half-built trace and stop throwing away the errors that never reach
the server." Every decision below mirrors an existing backend pattern rather than
inventing a frontend-specific one.

Three capabilities ride in, deliberately separated because their cost/risk
profiles differ:

```
  Tier 1  error capture      — closes prod blindness   — ship
  Tier 2  trace propagation  — completes _sentryTrace  — ship (cheap, backend ready)
  Tier 3  session replay     — biggest PII surface      — DEFER (post-launch)
```

## Decision 1 — DSN-gated init, mirroring the backend (SETTLED)

`apps/web/src/lib/sentry.ts` exposes `initFrontendSentry()`, a browser analog of
`initSentry()` in `packages/shared/src/sentry.ts`:

- **No DSN ⇒ no-op.** When `VITE_SENTRY_DSN` is empty/unset, skip `Sentry.init`
  entirely; the SDK's call-site helpers become no-ops. This is the default for
  dev and test and is the **primary kill switch** (no feature flag needed — the
  backend uses the same DSN gate).
- **Idempotent.** A module-level guard makes repeat calls no-ops (HMR-safe).
- `environment` from `import.meta.env.MODE`; `release` from a build-time
  `GIT_SHA` (Vite `define`), falling back to `"unknown"` with one console warning
  — exactly the backend's `GIT_SHA → "unknown"` behaviour.
- `sendDefaultPii: false`; `initialScope.tags = { service: 'web' }` mirroring the
  backend `initialScope.tags.service`.
- `tracesSampleRate`: 1.0 in dev, lower in prod (start 0.2 to match the backend;
  tune post-launch). Head-based, consistent with the backend so a propagated
  trace keeps a coherent sampling decision.

Why no OpenFeature flag gate (unlike the backend's `correlation-context-enabled`):
the DSN gate already gives an instant off switch, and a client-read flag can't
un-load an already-initialised browser SDK. Keep it simple for launch.

## Decision 2 — SentryLogger via the existing seam (SETTLED)

The frontend already has a swappable logger (`setLogger` / `Logger` interface,
`apps/web/src/lib/logger.ts`). No new plumbing: add a `SentryLogger` whose
`error(msg, err, ctx)` calls `Sentry.captureException(err ?? new Error(msg), {
extra: ctx })` and still writes to console; `info`/`warn` stay console-only (or
become breadcrumbs). Swap it in at boot, after `initFrontendSentry()`.

`AppErrorBoundary.componentDidCatch` already routes through this logger, so render
crashes flow to Sentry the moment the production logger is swapped — **zero change
to the boundary's call sites**. The boundary stays as the user-facing fallback
(`ErrorFallback` + toast); Sentry capture is additive. Global handlers
(`unhandledrejection`, `onerror`) are covered by the SDK's default integrations.

## Decision 3 — Sequence descriptor reuses the backend identity (SETTLED)

The privacy contract: **attach `{ sequenceHash, seqLen }`, never residues** — the
exact field pair the backend's `SubmissionLogPayload` already logs. The hash is
not merely a stand-in; it is the system join key
(`hash.ts` → `emb/{model}/{ver}/{sequenceHash}` Garage cache key), so a browser
error, the submission log line, and the cached artifact share one id.

Constraint: `packages/shared/src/hash.ts` does `import { createHash } from
'crypto'` — Node-only, not bundleable for the browser. So the frontend gets
`apps/web/src/lib/sequence-descriptor.ts` computing SHA-256 via
`crypto.subtle.digest('SHA-256', new TextEncoder().encode(sequence))` and hex-
encoding the result. This MUST produce byte-identical hex to `computeSequenceHash`
for the same input (UTF-8 bytes, lowercase hex) — enforced by a parity test so the
join key never silently diverges. The helper is async (Web Crypto is); callers
attaching descriptors await it or attach lazily.

Alternative considered & rejected: factor `computeSequenceHash` into an
isomorphic shared helper. Rejected for launch scope — it touches the shared
package's build/target matrix and risks the backend hot path; a tiny, parity-
tested frontend helper is lower blast radius. (Flagged as a possible post-launch
consolidation.)

## Decision 4 — Trace propagation at the single fetch chokepoint (SETTLED)

All gateway traffic funnels through `apiFetch` (`client.ts:9`) against
`VITE_GATEWAY_URL`. `BrowserTracing` with `tracePropagationTargets: [GATEWAY_URL]`
attaches `sentry-trace`/`baggage` to those requests only (not third-party calls).
The gateway already parses the inbound trace and continues the span into workers
via `_sentryTrace`, so no backend change is needed. The better-auth client
(`services/auth/client.ts`) shares `VITE_GATEWAY_URL` and is covered by the same
target.

Open implementation choice (resolve in tasks): rely on the SDK's automatic
`fetch` instrumentation vs. inject headers explicitly inside `apiFetch`. Automatic
is less code; explicit is more legible and avoids instrumenting unrelated fetches.
Lean automatic with `tracePropagationTargets` scoping; fall back to explicit if
the wrapper shape fights the SDK.

## Decision 5 — Defense-in-depth scrubbing, with a server-side net (SETTLED)

Three layers, mirroring the backend's discipline + redaction model:

```
  L1  descriptor not raw      (code)      { sequenceHash, seqLen }; no input values
                                          in breadcrumbs
  L2  beforeSend scrub        (code)      strip query strings + known input keys;
                                          sendDefaultPii: false
  L3  Advanced Data Scrubbing (Sentry     regex over long AA runs → [Filtered];
      on the shared project    settings)  ingest-time net, all services
```

L3 is **launch-blocking**. Rationale: the project has no scrubbing today, so the
current posture is discipline-only; the browser is the leakiest source; turning it
on without L3 regresses the shared project's privacy bar. L3 also retroactively
covers the backend's existing `Sentry.captureException(err)` paths. Regex starting
point: `[ACDEFGHIKLMNPQRSTVWY]{20,}` (≥20-residue runs of the 20 canonical amino
acids); length threshold keeps English false-positives rare. Tune against real
events post-launch.

**L3 is repo-owned, mirroring the alert-rules GitOps (preferred).** The project's
Advanced Data Scrubbing is the `relayPiiConfig` project option — a JSON blob of
`{rules, applications}`. It carries no fleet-private detail (regex + redaction
only), so it lives in-repo at `infra/observability/sentry-pii.json` next to the
code that emits the events, exactly as `infra/monitoring/protifer.rules.yml` lives
next to the metrics. The flow matches `rules-sync` in `build.yml`:

```
  PR  → validate sentry-pii.json (jq/schema; relay PII shape)
  main→ PATCH /api/0/projects/{org}/{project}/  { relayPiiConfig: <file> }
        reusing SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT (already in CI)
```

Same governance as alerts: **do not edit scrubbing in the Sentry UI** — UI edits
drift and are overwritten on the next sync (the PATCH replaces the project's
advanced rules, like `mimirtool rules sync`). The credentials already exist (the
`notify-sentry-release` job uses them), so no new secret surface.

Fallback (only if API sync is impractical for launch timing): an operator
checklist in the deploy runbook applies the same `sentry-pii.json` by hand. The
in-repo JSON stays canonical either way — the choice is only _who applies it_, not
_where it's defined_.

## Decision 6 — Source maps & release (SETTLED; one SHA ties the whole deploy)

Stack traces are worthless minified, so Vite emits source maps and CI uploads them
keyed by `release = github.sha`. The build/host is confirmed in-repo: the merged
`deploy-web` job in `build.yml` builds the SPA (`bun run --filter @protifer/web
build`, `VITE_GATEWAY_URL` from `vars`) and ships it to **Cloudflare Workers** via
`wrangler versions upload --tag "$GITHUB_SHA"` → `versions deploy` (main-only,
`environment: deploy`). `rollback.yml`'s `rollback-web` rolls back by the same tag.

So a single identifier already threads the entire deploy — and the frontend SDK
simply joins it:

```
   github.sha  ─┬─ backend images   ghcr…:<sha>           (build matrix)
                ├─ Cloudflare ver    wrangler --tag <sha>  (deploy-web)
                ├─ Sentry release    action-release <sha>  (notify-sentry-release)
                ├─ rollback target   rollback-web <sha>    (rollback.yml)
                └─ frontend runtime  VITE_GIT_SHA=<sha>    (THIS change)
   one browser error's `release` == the bundle == the images == the rollback unit
```

Two wiring points, both inside `deploy-web` (it already has the dist, the SHA, and
— being `environment: deploy` — the `SENTRY_*` secrets):

1. **Runtime release + DSN via Vite env** (not a `define`): add
   `VITE_SENTRY_DSN` (from `vars`, like `VITE_GATEWAY_URL`) and
   `VITE_GIT_SHA: ${{ github.sha }}` to the **Build SPA** step env. Vite exposes
   `VITE_`-prefixed vars on `import.meta.env`, so `initFrontendSentry()` reads
   `import.meta.env.VITE_GIT_SHA` for `release` and `VITE_SENTRY_DSN` for the
   gate. Because the SPA is built only in this main-only job, **dev/preview builds
   carry no DSN and stay no-op for free**.
2. **Source-map upload "through the Sentry release"** (per the chosen approach):
   `@sentry/vite-plugin` in `vite.config` uploads maps during the build with
   `release = VITE_GIT_SHA` and `filesToDeleteAfterUpload` so `.map` files are
   **removed before `wrangler` ships the bundle** — maps reach Sentry, never
   Cloudflare. `notify-sentry-release` is retained for commit association
   (`set_commits: auto`); `ignore_missing: true` keeps job ordering benign.

No deploy-side contract and no out-of-repo coordination — the entire wiring lands
in `deploy-web` + `vite.config`.

## Risks

- **Hash parity drift.** If the Web Crypto helper and `computeSequenceHash`
  diverge (encoding, casing), the join key breaks silently. Mitigation: parity
  unit test pinned to known vectors.
- **L3 owner unassigned.** The scrub rule lives in Sentry settings; if no one
  owns it before DSN goes live, sequences could land unscrubbed. Mitigation:
  task 0.x names the owner and gates DSN population on the rule existing.
- **Bundle weight.** `@sentry/react` + tracing adds ~25–35 KB gz; acceptable next
  to molstar/nightingale. Replay (deferred) would be the heavy add — kept out.
- **Event noise / quota on a shared project.** Browser-extension and network-blip
  errors inflate volume and mix with backend issues. Mitigation: `ignoreErrors`
  defaults, `service:web` tag for filtering, conservative `tracesSampleRate`.
- **Shared-project coupling.** Frontend leak risk now affects the backend's
  project. Accepted deliberately for unified traces + one DSN; L3 is the
  counterweight.
- **Source maps must not reach Cloudflare.** If `.map` files ship in the Worker
  bundle they are publicly fetchable. Mitigation: `@sentry/vite-plugin`
  `filesToDeleteAfterUpload` strips them after upload, before `wrangler` runs.
- **No staging web deploy exists.** `deploy-web` is main→production only, so
  there is no DSN-set non-prod environment to smoke-test in. Mitigation: a manual
  `wrangler versions upload` (no promote) for the DSN-set verification (task 9.3),
  or accept first validation on the production version pre-promote.
