import type { Logger, Plan, PlanResolver } from '@protifer/shared'

const VALID_PLANS: readonly Plan[] = ['free', 'pro', 'enterprise']

export interface DbPlanResolverDeps {
  getUser: (userId: string) => Promise<{ plan?: string } | null>
  logger?: Logger
}

export class DbPlanResolver implements PlanResolver {
  constructor(private readonly deps: DbPlanResolverDeps) {}

  async resolve(userId: string): Promise<Plan> {
    let user: { plan?: string } | null
    try {
      user = await this.deps.getUser(userId)
    } catch (err) {
      this.deps.logger?.warn(
        { err, userId },
        'DbPlanResolver: getUser failed, defaulting to free',
      )
      return 'free'
    }
    const raw = user?.plan
    if (raw && (VALID_PLANS as readonly string[]).includes(raw)) {
      return raw as Plan
    }
    return 'free'
  }
}
