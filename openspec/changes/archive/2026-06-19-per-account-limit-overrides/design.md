## Context

`DbPlanResolver.resolve(userId)` returns a bare `Plan` enum read from `SELECT plan FROM "user"`. Every quota decision then does its own `PLAN_LIMITS[plan]` lookup:

- `middleware/rate-limit.ts` → `submissionsPerMinute`
- `routes/_utils.ts` (`withinConcurrentJobLimit`) → `maxConcurrentJobs`
- submission validation → `MAX_SEQUENCE_LENGTH` (a single global constant, not yet per-plan)
- shedding → `sloSeconds[plan]` from `loadSheddingConfig`

Because the only DB-derived input is the class name, all accounts on a class share identical quotas. The `fix/shedding-residue-leak` branch added `RATE_LIMIT_SUBMISSIONS_*` env config, but those are global-per-class defaults (load-test driven) — they cannot express two enterprise customers with different agreements. This design introduces per-account overrides resolved at the existing resolver seam.

## Goals / Non-Goals

**Goals:**

- A single resolution seam returns merged `EffectiveLimits`; call sites stop indexing `PLAN_LIMITS` directly for quota.
- Per-account overrides stored in `user.limits jsonb`, sparse and partial.
- Override envelope: `submissionsPerMinute`, `maxConcurrentJobs`, `maxSequenceLength`, `sloSeconds`.
- Admin-only management surface; never user-editable.
- Plan enum preserved for priority + SLO class.

**Non-Goals:**

- Enterprise self-serve UI or billing/entitlement-provider integration.
- Removing or replacing the `RATE_LIMIT_SUBMISSIONS_*` env knobs (they remain the per-class defaults).
- Per-account _priority_ or _class_ overrides — scheduling stays class-based.

## Decisions

### 1. Resolver returns `EffectiveLimits`, not `Plan`

`PlanResolver.resolve` becomes `resolve(userId): Promise<ResolvedAccount>` where `ResolvedAccount = { plan: Plan; limits: EffectiveLimits }`. `limits` is computed as `mergeLimits(PLAN_LIMITS[plan]+slo, override)`. Call sites read `auth.limits.*`; scheduling reads `auth.plan`.

_Alternative considered:_ keep returning `Plan` and add a parallel `resolveLimits`. Rejected — two lookups invite drift and a second DB round-trip; one resolved object keeps the merge in one place.

### 2. Carry resolved limits on the auth context

The auth context already exposes `{ sub, plan }`. Extend it to `{ sub, plan, limits }` so middleware and route utils read the pre-merged object without re-querying. The DB read already happens during plan resolution; the override travels in the same row (`SELECT plan, limits FROM "user"`), so no extra query.

### 3. jsonb sparse override, validated with Zod

`limits jsonb` (nullable). Stored value is a partial object; a Zod schema (`OverrideLimitsSchema`) validates positive integers per field and `.strict()` rejects unknown keys. jsonb chosen for flexibility — the agreement-shaped envelope is expected to grow and is rarely touched, so typed columns + migrations per field would be churn for little gain. The merge is `{ ...defaults, ...parsed }`; a parse failure is logged and treated as no override (fail-safe to class defaults).

_Alternative considered:_ typed columns. Rejected for now — premature rigidity; revisit if the envelope stabilizes or needs DB-level constraints.

### 4. `maxSequenceLength` becomes plan-aware

Today `MAX_SEQUENCE_LENGTH` is one global constant. The default per-class value seeds from that constant for all classes (no behavior change by default); the override can raise it per account. Submission validation reads `auth.limits.maxSequenceLength`.

### 5. SLO seconds resolved through the same object

`loadSheddingConfig().sloSeconds` provides the class default. The resolver overlays a per-account `sloSeconds` when present. The shedding decision reads the account's resolved value rather than indexing the global config by plan. Default behavior unchanged when no override is set.

### 6. Admin route mirrors flag overrides

`PUT /admin/accounts/{userId}/limits` (validate + persist) and `DELETE` (clear → NULL), guarded by the same admin authorization as `PUT /admin/flags/<name>`. No GET on a user-facing route; an admin GET is optional and in scope for the admin surface only.

**PUT is full-replace**: the request body becomes the entire stored override object (any field not present is dropped, not merged). `DELETE` sets the column NULL to revert to class defaults. Chosen over PATCH/merge for predictability — there is one obvious way to read or reset an account's override, and "clear one field" needs no null-sentinel convention. PATCH deferred unless an operator workflow demands it.

## Risks / Trade-offs

- **Auth-context shape change ripples to every consumer** → Centralize the type in one place (`Variables`/auth type) and let the typechecker enumerate call sites; the compiler turns the ripple into a checklist.
- **jsonb lets malformed data reach the row out-of-band** (manual SQL, bad seed) → Resolver parses defensively and falls back to class defaults on any parse failure; never throws into the request path.
- **Override silently widens limits beyond infra capacity** (e.g. someone sets `submissionsPerMinute: 10^6`) → Validation caps with sane `.max()` bounds; shedding remains the backstop since it operates on observed throughput, not declared limits.
- **Drift between class default sources** (`PLAN_LIMITS`, `RATE_LIMIT_SUBMISSIONS_*` env, SLO config) → Resolver composes the class default from the same sources the gateway already loads at boot; no new default table.
- **Stale resolved limits within a request** → Limits resolve per request at auth time (same cadence as plan today); an override change takes effect on the next request, consistent with current plan-change behavior.

## Migration Plan

1. Add nullable `user.limits jsonb` column (additive migration; no backfill — NULL = class defaults).
2. Ship resolver + auth-context change; all defaults equal current behavior, so deploying with zero overrides is a no-op.
3. Add admin route last; until it exists, overrides can only be set via seed/SQL (used for the dev seed example).
4. **Rollback:** revert code (resolver falls back to class defaults regardless of column); the nullable column can remain unused with no effect.

## Open Questions

- Do we want an audit-log line on override set/clear? Likely yes (reuse the submission/admin logging idiom), but not blocking.
