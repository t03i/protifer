import type { AuthContext } from '@protifer/shared'
import { getCorrelation, runWithCorrelation } from '@protifer/shared'
import * as Sentry from '@sentry/node'
import { createMiddleware } from 'hono/factory'

import type { Variables } from '../types/hono.ts'

/**
 * Enrich the active correlation frame with the authenticated user's opaque id
 * and verified auth method. Enrichment-only: when no frame is active
 * (correlation disabled, OPTIONS preflight) or no user is authenticated, it
 * passes through without creating a frame. The outer frame is never mutated —
 * a nested ALS frame carries the additional fields. PII minimization: only
 * `sub` and `method` enter the frame; never email/plan/role.
 */
export function createUserContextMiddleware() {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    // May be absent: this middleware is also reachable without authenticate
    // upstream (defensive, mirrors shedding.ts).
    const auth = c.get('auth') as AuthContext | undefined
    const ctx = getCorrelation()
    if (!auth || !ctx) {
      await next()
      return
    }
    Sentry.setUser({ id: auth.sub })
    await runWithCorrelation(
      { ...ctx, userId: auth.sub, authMethod: auth.method },
      next,
    )
  })
}
