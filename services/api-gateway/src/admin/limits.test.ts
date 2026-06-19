import type { AuthContext, EffectiveLimits } from '@protifer/shared'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { createLimitsAdminRouter } from './limits.ts'
import { createAdminRoleMiddleware } from '../middleware/admin-role.ts'
import type { Variables } from '../types/hono.ts'

const defaultLimits: EffectiveLimits = {
  submissionsPerMinute: 300,
  maxConcurrentJobs: 50,
  maxSequenceLength: 4096,
  sloSeconds: 0,
}

function makeApp(opts: {
  auth?: Partial<AuthContext> | null
  setLimits?: (userId: string, limits: unknown) => Promise<number>
  clearLimits?: (userId: string) => Promise<number>
}) {
  const setLimits = vi.fn(opts.setLimits ?? (() => Promise.resolve(1)))
  const clearLimits = vi.fn(opts.clearLimits ?? (() => Promise.resolve(1)))
  const app = new Hono<{ Variables: Variables }>()
  if (opts.auth !== null) {
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'admin1',
        email: 'admin@x.com',
        plan: 'enterprise',
        limits: defaultLimits,
        method: 'session',
        role: 'admin',
        ...opts.auth,
      })
      await next()
    })
  }
  app.use('*', createAdminRoleMiddleware())
  app.route(
    '/admin',
    createLimitsAdminRouter({
      setLimits: setLimits as never,
      clearLimits,
    }),
  )
  return { app, setLimits, clearLimits }
}

describe('createLimitsAdminRouter', () => {
  it('sets a valid override', async () => {
    const { app, setLimits } = makeApp({})
    const res = await app.request('/admin/accounts/u1/limits', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxConcurrentJobs: 25 }),
    })
    expect(res.status).toBe(200)
    expect(setLimits).toHaveBeenCalledWith('u1', { maxConcurrentJobs: 25 })
  })

  it('rejects an invalid override', async () => {
    const { app, setLimits } = makeApp({})
    const res = await app.request('/admin/accounts/u1/limits', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxConcurrentJobs: -1, bogus: 1 }),
    })
    expect(res.status).toBe(400)
    expect(setLimits).not.toHaveBeenCalled()
  })

  it('returns 404 when the user does not exist', async () => {
    const { app } = makeApp({ setLimits: () => Promise.resolve(0) })
    const res = await app.request('/admin/accounts/missing/limits', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxConcurrentJobs: 25 }),
    })
    expect(res.status).toBe(404)
  })

  it('clears an override', async () => {
    const { app, clearLimits } = makeApp({})
    const res = await app.request('/admin/accounts/u1/limits', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    expect(clearLimits).toHaveBeenCalledWith('u1')
    expect(await res.json()).toEqual({ userId: 'u1', limits: null })
  })

  it('rejects a non-admin caller', async () => {
    const { app, setLimits } = makeApp({ auth: { role: 'user' } })
    const res = await app.request('/admin/accounts/u1/limits', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxConcurrentJobs: 25 }),
    })
    expect(res.status).toBe(403)
    expect(setLimits).not.toHaveBeenCalled()
  })
})
