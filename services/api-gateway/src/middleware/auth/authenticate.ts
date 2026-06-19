import type { PlanResolver } from '@protifer/shared'
import { createMiddleware } from 'hono/factory'

import type { Auth } from '../../auth/index.ts'
import type { UserDirectory } from '../../auth/user-directory.ts'
import type { Variables } from '../../types/hono.ts'

const BEARER_PREFIX = /^Bearer\s+(\S+)$/

function extractBearer(headerValue: string | undefined): string | null {
  if (!headerValue) return null
  const m = BEARER_PREFIX.exec(headerValue)
  return m?.[1] ?? null
}

export interface AuthenticateDeps {
  auth: Auth
  resolver: PlanResolver
  userDirectory?: UserDirectory
}

export function createAuthenticateMiddleware({
  auth,
  resolver,
  userDirectory,
}: AuthenticateDeps) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const bearerKey = extractBearer(c.req.header('Authorization'))
    if (bearerKey !== null) {
      let result: Awaited<ReturnType<Auth['api']['verifyApiKey']>> | null = null
      try {
        result = await auth.api.verifyApiKey({ body: { key: bearerKey } })
      } catch {
        return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
      }
      if (!result.valid || result.key === null) {
        return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
      }
      const referenceId = result.key.referenceId
      if (typeof referenceId !== 'string' || referenceId.length === 0) {
        return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
      }
      if (!userDirectory) {
        return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
      }
      const user = await userDirectory.getUser(referenceId)
      if (!user) {
        return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
      }
      const { plan, limits } = await resolver.resolve(user.id, user.email)
      const role =
        user.role === 'admin' || user.role === 'user' ? user.role : undefined
      c.set('auth', {
        sub: user.id,
        email: user.email,
        plan,
        limits,
        method: 'api-key',
        ...(role ? { role } : {}),
      })
      await next()
      return
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session?.user) {
      return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
    }
    const { plan, limits } = await resolver.resolve(
      session.user.id,
      session.user.email,
    )
    const role = (session.user as { role?: string }).role
    c.set('auth', {
      sub: session.user.id,
      email: session.user.email,
      plan,
      limits,
      method: 'session',
      ...(role === 'admin' || role === 'user' ? { role } : {}),
    })
    await next()
  })
}
