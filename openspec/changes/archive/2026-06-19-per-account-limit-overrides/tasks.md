## 1. Shared resolution layer (`packages/shared`)

- [x] 1.1 Define `EffectiveLimits` type (`submissionsPerMinute`, `maxConcurrentJobs`, `maxSequenceLength`, `sloSeconds`) and `ResolvedAccount = { plan: Plan; limits: EffectiveLimits }` in `plan.ts`
- [x] 1.2 Add `OverrideLimitsSchema` (Zod, `.strict()`, positive-int fields with sane `.max()` caps) and an exported `LimitsOverride` type
- [x] 1.3 Add `mergeLimits(classDefaults, override)` field-by-field merge helper; absent/invalid → class default
- [x] 1.4 Change `PlanResolver.resolve` contract to return `ResolvedAccount`; export `MAX_SEQUENCE_LENGTH` as the per-class default seed
- [x] 1.5 Unit-test merge + schema (no override, partial override, invalid/unknown-field rejection)

## 2. DB resolver + auth context (`services/api-gateway`)

- [x] 2.1 Extend the user query to `SELECT plan, limits FROM "user"` and parse `limits` defensively in `DbPlanResolver`
- [x] 2.2 Resolver composes class defaults from existing config sources (`PLAN_LIMITS`, `RATE_LIMIT_SUBMISSIONS_*`, shedding `sloSeconds`) and merges the override; parse failure logs + falls back
- [x] 2.3 Extend the auth/`Variables` context type from `{ sub, plan }` to `{ sub, plan, limits }`; populate at resolution
- [x] 2.4 Update `DbPlanResolver` unit tests (no override, partial override, read failure → defaults)

## 3. Quota consumers read resolved limits

- [x] 3.1 `middleware/rate-limit.ts`: read `auth.limits.submissionsPerMinute` instead of `PLAN_LIMITS[plan]`
- [x] 3.2 `routes/_utils.ts` (`withinConcurrentJobLimit`): read `auth.limits.maxConcurrentJobs`
- [x] 3.3 Submission validation: enforce `auth.limits.maxSequenceLength` per request
- [x] 3.4 Shedding decision: use the account's resolved `sloSeconds` rather than indexing global config by plan
- [x] 3.5 Update affected unit tests; confirm defaults reproduce current behavior with no override

## 4. Persistence

- [x] 4.1 Add additive migration: nullable `user.limits jsonb` column (no backfill)
- [x] 4.2 Add an example override to `infra/postgres/seeds/dev-users-plan.sql`

## 5. Admin management surface

- [x] 5.1 Add `admin/limits.ts` route: `PUT /admin/accounts/{userId}/limits` (validate via `OverrideLimitsSchema`, persist) guarded by existing admin authorization
- [x] 5.2 Add `DELETE /admin/accounts/{userId}/limits` (set column NULL → revert to class defaults)
- [x] 5.3 Emit an audit log line on set/clear (reuse admin/submission logging idiom)
- [x] 5.4 Add route tests: valid set, invalid rejected, clear reverts, non-admin rejected

## 6. Verification

- [x] 6.1 `bun run typecheck && bun run lint && bun run test` green
- [x] 6.2 Backend E2E (`bun run test:int`) covering an account with an override enforcing different limits than its plan default
- [x] 6.3 Update CLAUDE.md plan/auth notes if the auth-context shape change warrants it
