import type { AuthContext, LimitsOverride, Logger } from '@protifer/shared'
import { OverrideLimitsSchema } from '@protifer/shared'
import { Hono } from 'hono'

import type { Variables } from '../types/hono.ts'

export interface LimitsAdminDeps {
  /** Persist a full-replace override; returns affected row count. */
  setLimits: (userId: string, limits: LimitsOverride) => Promise<number>
  /** Clear the override (column → NULL); returns affected row count. */
  clearLimits: (userId: string) => Promise<number>
  logger?: Logger
}

function adminIdentity(c: { get: (k: 'auth') => AuthContext }): string {
  const auth = c.get('auth')
  return auth.email || auth.sub
}

export function createLimitsAdminRouter(deps: LimitsAdminDeps) {
  const { setLimits, clearLimits, logger } = deps
  const router = new Hono<{ Variables: Variables }>()

  router.put('/accounts/:userId/limits', async (c) => {
    const userId = c.req.param('userId')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400)
    }
    const parsed = OverrideLimitsSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: parsed.error.issues[0]?.message ?? 'Invalid override',
          code: 'VALIDATION_ERROR',
        },
        400,
      )
    }
    const affected = await setLimits(userId, parsed.data)
    if (affected === 0) {
      return c.json({ error: 'Unknown user', code: 'USER_NOT_FOUND' }, 404)
    }
    logger?.info(
      { targetUserId: userId, adminId: adminIdentity(c), limits: parsed.data },
      'admin: set account limits override',
    )
    return c.json({ userId, limits: parsed.data }, 200)
  })

  router.delete('/accounts/:userId/limits', async (c) => {
    const userId = c.req.param('userId')
    const affected = await clearLimits(userId)
    if (affected === 0) {
      return c.json({ error: 'Unknown user', code: 'USER_NOT_FOUND' }, 404)
    }
    logger?.info(
      { targetUserId: userId, adminId: adminIdentity(c) },
      'admin: cleared account limits override',
    )
    return c.json({ userId, limits: null }, 200)
  })

  return router
}
