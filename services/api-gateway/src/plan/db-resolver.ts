import type {
  EffectiveLimits,
  LimitsOverride,
  Logger,
  Plan,
  PlanResolver,
  ResolvedAccount,
} from '@protifer/shared'
import { OverrideLimitsSchema, mergeLimits } from '@protifer/shared'

const VALID_PLANS: readonly Plan[] = ['free', 'pro', 'enterprise']

export interface DbPlanResolverDeps {
  getUser: (
    userId: string,
  ) => Promise<{ plan?: string; limits?: unknown } | null>
  classDefaults: Record<Plan, EffectiveLimits>
  logger?: Logger
}

export class DbPlanResolver implements PlanResolver {
  constructor(private readonly deps: DbPlanResolverDeps) {}

  async resolve(userId: string): Promise<ResolvedAccount> {
    let user: { plan?: string; limits?: unknown } | null
    try {
      user = await this.deps.getUser(userId)
    } catch (err) {
      this.deps.logger?.warn(
        { err, userId },
        'DbPlanResolver: getUser failed, defaulting to free',
      )
      return { plan: 'free', limits: this.deps.classDefaults.free }
    }

    const raw = user?.plan
    const plan: Plan =
      raw && (VALID_PLANS as readonly string[]).includes(raw)
        ? (raw as Plan)
        : 'free'

    let override: LimitsOverride | undefined
    if (user?.limits != null) {
      const parsed = OverrideLimitsSchema.safeParse(user.limits)
      if (parsed.success) {
        override = parsed.data
      } else {
        this.deps.logger?.warn(
          { userId, issues: parsed.error.issues },
          'DbPlanResolver: invalid limits override, using class defaults',
        )
      }
    }

    return {
      plan,
      limits: mergeLimits(this.deps.classDefaults[plan], override),
    }
  }
}
