# protifer monorepo

Versions live in `package.json` / `bun.lock` — read those for exact numbers. This file is only for what the code can't tell you.

## Stack

Bun · TypeScript strict · React 19 + Vite · Hono + Zod-OpenAPI · BullMQ/Redis · Postgres (better-auth) · S3/Garage · Triton (gRPC) · OpenFeature (`@openfeature/server-sdk`, `@openfeature/web-sdk`) for feature flags.

OpenFeature is the SDK boundary; the in-process `FlagsProvider` (`packages/shared/src/flags/provider.ts`) is the implementation. App code calls `client.getBooleanValue(name, default, ctx)` only — never reaches into the registry or store directly. Swapping to a hosted backend (Statsig, LaunchDarkly, GrowthBook) is `OpenFeature.setProvider(...)` at boot. Verified to run on Bun.

## Layout

| Path                         | Role                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/web`                   | `@protifer/web` — React + TanStack Router frontend (Vite), shadcn/ui                        |
| `services/api-gateway`       | Hono REST API — entry `src/index.ts`, port via `PORT` env                                   |
| `services/embedding-worker`  | BullMQ consumer → Triton → S3                                                               |
| `services/prediction-worker` | BullMQ consumer → Triton → S3                                                               |
| `packages/shared`            | `@protifer/shared` — types, `ObjectStore`, `AppError`, logger, plan limits, BullMQ wrappers |
| `packages/triton-client`     | `@protifer/triton-client` — typed gRPC client, model-name types                             |
| `packages/eslint-config`     | shared lint rules (`react.js`, `node.js`)                                                   |
| `infra/*`                    | docker-compose, migrations, storage setup                                                   |

Workspaces: `packages/*`, `services/*`, `apps/*`, `infra/*`, `tests/*`, `scripts`.

## Imports & modules

- Web app alias: `#/*` → `./src/*` (see `apps/web/tsconfig.json`, `imports` in its `package.json`).
- Named exports only; no barrel files — import directly from feature paths (e.g. `#/features/auth/context`).
- Feature-first organization under `apps/web/src/features/{auth,input,predictions,interactive,structure,enrichment,uniref}`.

## Frontend UI

- **shadcn/ui** — config in `apps/web/components.json`, generated primitives live in `apps/web/src/components/ui/` (do not hand-edit; re-add via `bunx shadcn@latest add <name>`).
- Tailwind CSS + `cn()` helper for class composition; Radix primitives underneath.
- Protein visualization: `@nightingale-elements/*`, `pdbe-molstar`, `@swissprot/swissbiopics-visualizer` — wrapped as React components inside the relevant feature folder.

## Data boundaries

- **Server state** → TanStack Query (source of truth for job status, predictions, UniProt).
- **UI state** → Redux, single `selection` slice at `apps/web/src/store/selection.ts`. Nothing else belongs in Redux.
- **Feature scope** → React Context: `AuthContext`, `SequenceContext` (`features/predictions/context/sequence-context.tsx`).
- **URL state** → TanStack Router params/search.
- **Redis** → BullMQ queues, active-job tracking, rate-limit counters.
- **S3/Garage** → embeddings + prediction results, **hash-keyed immutable**.
- **Postgres** → users + better-auth sessions only.

## Feature flags

- Registry at `packages/shared/src/flags/definitions.ts`. Every flag declares description, Zod type, default, owner, targeting (`global` / `plan` / `percentage`), `createdAt`, `expiresAt`, optional `productionSafe`.
- Read via OpenFeature only: `OpenFeature.getClient().getBooleanValue(name, default, ctx)` server-side, `useFlag(name, default)` (React) client-side.
- Overrides: `PUT /admin/flags/<name>` (admin-only). Cached 5s in-process; flips take effect ≤5s without restart.
- CI gate: `bun run flags:lint` rejects expired/dead/undeclared references. Removed flags go in `archived-flags.json` so the lint stays clean during deprecation.
- `productionSafe: true` makes a flag always resolve to its default in `NODE_ENV=production`, regardless of the override (dev-only kill switches).

## Jobs

- BullMQ with `FlowProducer` for chained jobs; `Queue`/`Worker`/`FlowProducer` wrappers and retry/backoff defaults live in `packages/shared/src/queue.ts`.
- Workers handle SIGTERM by draining the queue and closing the Triton connection.
- Admission (request-shedding) lives at the gateway — `services/api-gateway/src/shedding/` + `middleware/shedding.ts`. Class-based SLOs drive 503 + Retry-After; BullMQ priority per plan drains paying tiers first. Defaults to shadow mode; flip with `SHED_MODE=enforce`. Operator rollout/tuning lives in `deploy-app`'s `RUNBOOK.md`.

## Configuration

- **Typed `loadConfig()` per service** — `services/<name>/src/config/` (gateway) or `services/<name>/src/config.ts` (workers) defines all runtime config with Zod and feature-section grouping. App code reads `config.section.field`, never `process.env` directly.
- **Two readers, two precedence rules** in `@protifer/shared`:
  - `readSecret(name)` — file-wins (`NAME_FILE` first, then `NAME` env). Use for credentials. Matches Docker/Postgres/k8s convention; secret pipeline beats env-leak surface.
  - `readConfig(name)` — env-wins (`NAME` first, then `NAME_FILE`). Use for tunables. Matches 12-factor.
- Choice is declarative via `secretField()` / `configField()` in the schema.
- **Static manifests** (model URLs, etc.) live in the prod deploy repo (`<deploy-org>/deploy-app`, `manifests/*.json`), mounted at known paths in containers. Triton init reads `MODEL_MANIFEST_PATH`. Dev uses mock-triton and needs no manifest.
- **Local file-mounted secrets** (optional) live in `infra/secrets/` (gitignored). `readSecret` falls back to env so dev workflows keep working without populating that directory.

## API contracts

- Zod schemas + `@hono/zod-openapi` → runtime validation, OpenAPI spec, frontend types via `openapi-typescript` + `openapi-fetch`.
- Example: `services/api-gateway/src/schemas/predictions.ts`.
- Swagger UI and Bull Board admin are mounted on the API gateway.

## Auth & rate limits

- better-auth + GitHub OAuth. Middleware enriches Hono context with the user; frontend `AuthProvider` (`apps/web/src/features/auth/context.tsx`) mirrors session state and sends `credentials: 'include'`.
- Rate limits (submission + poll tiers) defined in `services/api-gateway/src/middleware/rate-limit.ts`; Redis-backed via `hono-rate-limiter`.
- Per-plan quotas in `packages/shared/src/plan.ts`.

## Errors

- `AppError` (`packages/shared/src/errors.ts`) — server-side typed errors with HTTP status + details. Async code throws; route handlers translate.
- `APIException` — client-side HTTP error class.
- `AppErrorBoundary` (`apps/web/src/components/error/AppErrorBoundary.tsx`) — React render failures.
- Workers rely on BullMQ retries; failed jobs are logged with job-id context.

## Logging

- Pino via `createLogger('component')` from `@protifer/shared`.
- Correlation: job IDs as context keys; the `← response` HTTP summary line includes method/path/status and, for authenticated routes, `userId`/`authMethod` (explicit props — the post-`next()` continuation runs outside the nested ALS frame).

### Observability and correlation

- Every pino line emitted while a request or job is in flight carries `requestId`, `traceId`, and `spanId` (stamped by the shared mixin in `packages/shared/src/correlation.ts` — log fields are camelCase; snake_case names like `request_id`/`_sentryTrace` are the job-data wire fields only). Startup/boot lines omit these fields rather than write empty strings.
- Authenticated requests additionally carry `userId` (opaque better-auth `sub`) and `authMethod` (`api-key` | `session`) on every line downstream of auth, enriched by `createUserContextMiddleware` (mounted right after each `createAuthenticateMiddleware` mount — keep these in lockstep). Workers carry `userId` rehydrated from `data.userId`. PII minimization: only the opaque `sub` and `authMethod` enter the frame — never email/plan/role; `defaultPinoOptions()` redacts `email`/`authorization`/`ip` as a safety net.
- The Gateway honours an inbound `X-Request-Id` header matching `^[a-zA-Z0-9_-]{8,128}$` (else mints a 32-hex id) and echoes it on every response. Workers inherit the same request id via `data.request_id` on the BullMQ job, alongside `_sentryTrace` for span continuation.
- Correlation reads the trace id via `@opentelemetry/api` (`trace.getActiveSpan().spanContext()`), never `@sentry/node` helpers — the SDK boundary is vendor-neutral so swapping the exporter (Sentry → OTLP) touches zero log code.
- Submission events: every `POST /v1/predictions` and `POST /v1/embeddings` emits one info-level log line with `msg: "submission"` and the descriptor payload (no raw sequence).
- Feature flag: `correlation-context-enabled` (default `true`, `productionSafe: false`) gates the middleware and worker wrapper. Flip off to revert to pre-change behaviour (no `traceId` in logs, no root span at the Gateway, no user enrichment — it's frame-inherited).

### Metrics & alerting

- The Gateway exposes a `prom-client` registry at `/metrics` (`services/api-gateway/src/metrics.ts`): HTTP histograms, shedding/flags counters, and the `bullmq_*` pipeline metrics (queue depth incl. `waiting-children`, wait/processing/total latency histograms, failure counter with a closed `reason_class` taxonomy, retry/attempts/stalled, and the FAIL-04 `bullmq_stale_children_*` gauges). Pipeline metrics are wired in `pipeline-metrics.ts` off the shared `QueueEvents`; the stale-children gauge rides the job-cleanup leader sweep (observe-only). Counters reset on restart — alert exprs are `rate()`/`increase()`-based.
- Metrics are **push-only**: a Grafana Alloy agent on each host (both hand-owned in the deploy repos) scrapes that host's targets and remote-writes to Grafana Cloud — the app-tier agent (`deploy-app`) scrapes triton/api-gateway, the state-tier agent (`deploy-state`) scrapes garage locally (no cross-host scrape; each stamps `host="app"`/`host="state"` so the two agents' self-metrics don't collide). No Prometheus/Alertmanager/monitoring UI runs anywhere; Bull Board is manual-ops only.
- Alert rules are monorepo-owned at `infra/monitoring/protifer.rules.yml` (no fleet-private detail): `promtool` validates on every PR, `mimirtool rules sync` deploys to the Grafana Cloud Mimir ruler on `main`. Alert delivery (Telegram + email) is vendor-configured — no delivery secret in any repo or CI. GitOps flow: `infra/monitoring/README.md`; metrics catalog + rule catalog + topology: `deploy-app`'s runbook.

## Storage abstraction

- `ObjectStore` interface in `packages/shared/src/storage.ts`.
- Factories: `createS3ObjectStore` (prod), `makeInMemoryStore` (tests).

## Testing

- Vitest + `@testing-library/react`. Unit/component tests co-located as `*.test.ts(x)`.
- Backend E2E suite lives in `tests/backend-e2e/` (vitest, hits real Redis/queues via `helpers.ts`). Excluded from default `bun run test`; run via `bun run test:int`.
- Load scenarios in `tests/load/` (`rate-limiter.js`, `throughput.js`).

## Dev workflow & quality gates

Every commit must pass typecheck, lint, and format. Every feature must pass E2E before being called done.
Changes must be committed at sensible points using semantic commit messages.

**On every commit (enforced by Husky + lint-staged):**

- `.husky/pre-commit` runs `bunx lint-staged` — config at `lint-staged.config.mjs`.
- For staged `.ts`/`.tsx`: `eslint --fix` + `bun run --cwd <workspace> typecheck` per affected workspace.
- For staged `.js`/`.mjs`/`.cjs`: `eslint --fix`.
- Everything prettier-eligible: `bunx prettier --write --ignore-unknown`.
- Never bypass with `--no-verify`; fix the underlying issue.

**Before opening a PR / calling a feature done, run from repo root:**

```bash
bun run typecheck      # turbo run typecheck — all workspaces
bun run lint           # turbo run lint
bun run format         # bunx prettier --check .
bun run test           # unit + component tests (excludes backend-e2e)
bun run test:int       # integration + backend E2E — requires local stack up
bun run build          # turbo run build — catches prod-only type/bundle errors
```

**E2E prerequisites:** the docker stack must be running before `test:int`. Bring it up from `infra/` (`.env*` files are gitignored — copy `infra/.env.dev` into any worktree before `docker compose up`).

**UI changes:** run `bun run dev:web`, exercise the flow in the browser, and check at least one regression-adjacent path before declaring done. Typechecking proves code compiles, not that the feature works.

## Tooling

- Runtime is **Bun** — use `bun run <script>`, `bun tsc --noEmit`. Never pnpm/npm.
- Turbo orchestrates across workspaces; Husky + lint-staged run on commit.
- ESLint (TanStack config, extended in `packages/eslint-config`), Prettier (`prettier.config.mjs`).
- TS strict, ES2022 target for web, ESNext for libs, `bundler` resolution.

## Conventions worth naming

- Error class idiom: extend `Error` and set `this.name` explicitly.
- Functions with multiple args take a single options object with defaults (see `fetchWithTimeout`).
- Interfaces/types use descriptive names without `I`-prefix (`AuthContextValue`, not `IAuthContext`).

## Development rules

- A new feature should be developed on a new worktree and end in a PR unless explicitly told otherwise.
- To create a new worktree also copy infra/.env.dev to the new worktree
- Check the CI run of the PR after around ~5min runtime and fix in case not all runs green.
- Do not add verbose comments that just describe the code; Only use required comments and be brief about it.
- If you are working on a PR'd branch already always push your commits to avoid it being merged stale.
