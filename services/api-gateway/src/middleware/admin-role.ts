import { createMiddleware } from 'hono/factory'

import type { Variables } from '../types/hono.ts'

/**
 * Gate routes under /admin/* on better-auth session + role === 'admin'.
 *
 * Reads role from c.get('auth') populated by createAuthenticateMiddleware upstream —
 * do not re-fetch the session here.
 *
 * Role assignment: the users.role column lands via scripts/migrate.ts with
 * default 'user'. Operator promotes themselves post-deploy with:
 *   UPDATE "user" SET role = 'admin' WHERE email = '…';
 */
export function createAdminRoleMiddleware() {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const ctx = c.get('auth') as { role?: 'admin' | 'user' } | undefined
    if (!ctx) {
      return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
    }
    if (ctx.role !== 'admin') {
      return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)
    }
    await next()
  })
}
