## Why

Today `DbPlanResolver` reads only the `plan` enum name from Postgres, and every downstream consumer does a static `PLAN_LIMITS[plan]` lookup. As a result "enterprise" is just a bigger static tier — a generous pro — and two enterprise customers with different contractual limits are impossible to express. The original intent was that enterprise limits follow the per-customer agreement. This change wires that intent without turning every quota into a deployment-global env knob (which is what the load-test-motivated `RATE_LIMIT_SUBMISSIONS_*` config does, and which cannot differentiate two accounts on the same plan).

## What Changes

- Split the meaning carried by the `plan` enum into two concerns:
  - **Class** — queue priority and SLO bucket. Stays an enum (`free` | `pro` | `enterprise`); a small ordered set is correct for scheduling.
  - **Quota** — numeric entitlements (`submissionsPerMinute`, `maxConcurrentJobs`, `maxSequenceLength`, SLO seconds). Becomes per-account overridable.
- Add a `limits jsonb` column to the Postgres `user` table holding a sparse, partial override object. Absent column / absent field = fall back to the plan default.
- Change the plan-resolution seam: the resolver returns **EffectiveLimits** (`account.overrides ?? PLAN_LIMITS[class]`, merged field-by-field) instead of a bare `Plan` enum. The enum is still exposed for priority + SLO-class selection.
- Update consumers to read resolved limits: `middleware/rate-limit.ts` (submissions/min), `routes/_utils.ts` (concurrency), submission validation (`MAX_SEQUENCE_LENGTH`), and shedding SLO seconds.
- Add an **admin-only** endpoint to set/clear an account's override (mirrors the existing `PUT /admin/flags/<name>` pattern). No enterprise self-serve — overrides are never user-editable.

## Capabilities

### New Capabilities

- `plan-limits`: Resolution of an account's effective quota limits — merging per-account DB overrides over plan-class defaults — and the admin surface for managing those overrides. Establishes the class-vs-quota boundary that scheduling (priority/SLO) and quota enforcement (rate limit/concurrency/sequence length) both consume.

### Modified Capabilities

<!-- request-shedding lives only in the unarchived fix-shedding-residue-leak change delta; no published spec to amend. SLO-seconds resolution is captured as a requirement in the new plan-limits capability. -->

## Impact

- **DB**: new `user.limits jsonb` column (nullable) + migration; dev seed (`infra/postgres/seeds/dev-users-plan.sql`) gains an example override.
- **Code**: `packages/shared/src/plan.ts` (`PlanResolver` contract → `EffectiveLimits`, override-merge helper, Zod override schema), `services/api-gateway/src/plan/db-resolver.ts`, `middleware/rate-limit.ts`, `routes/_utils.ts`, shedding SLO lookup, submission length validation, new `admin/limits.ts` route.
- **API**: new admin route `PUT/DELETE /admin/accounts/{userId}/limits`; no change to public submission contracts (behavior differs only by resolved numbers).
- **Auth/PII**: override values are non-PII operational numbers; admin route reuses existing admin authorization.
- **Out of scope**: enterprise self-serve UI, billing integration, the `RATE_LIMIT_SUBMISSIONS_*` env knobs (they remain as global-per-class defaults feeding `PLAN_LIMITS`).
