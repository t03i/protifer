import { Hono } from 'hono'
import { describe, it, expect, vi } from 'vitest'

import { createCleanupAdminRouter } from './cleanup.ts'
import type { CleanupHandle, SweepResult } from '../cleanup.ts'
import { createAdminRoleMiddleware } from '../middleware/admin-role.ts'
import type { Variables } from '../types/hono.ts'

function makeHandle(result: SweepResult): CleanupHandle & {
  reconcileNow: ReturnType<typeof vi.fn>
} {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    reconcileNow: vi.fn().mockResolvedValue(result),
  }
}

const baseResult: SweepResult = {
  sweptKeys: 2,
  removedEntries: 1,
  removedByReason: { completed: 1, failed: 0, 'no-job': 0 },
  durationMs: 5,
}

describe('createCleanupAdminRouter', () => {
  it('authorized admin triggers a sweep and returns 200 with SweepResult', async () => {
    const handle = makeHandle(baseResult)
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'u1',
        email: 'a@x.com',
        plan: 'free',
        role: 'admin',
      })
      await next()
    })
    app.use('*', createAdminRoleMiddleware())
    app.route('/admin/cleanup', createCleanupAdminRouter(handle))

    const res = await app.request('/admin/cleanup/reconcile', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as SweepResult
    expect(body).toEqual(baseResult)
    expect(handle.reconcileNow).toHaveBeenCalledTimes(1)
  })

  it('unauthenticated caller is rejected 401 and does not run sweep', async () => {
    const handle = makeHandle(baseResult)
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAdminRoleMiddleware())
    app.route('/admin/cleanup', createCleanupAdminRouter(handle))

    const res = await app.request('/admin/cleanup/reconcile', {
      method: 'POST',
    })
    expect(res.status).toBe(401)
    expect(handle.reconcileNow).not.toHaveBeenCalled()
  })

  it('non-admin caller is rejected 403 and does not run sweep', async () => {
    const handle = makeHandle(baseResult)
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', async (c, next) => {
      c.set('auth', { sub: 'u1', email: 'a@x.com', plan: 'free', role: 'user' })
      await next()
    })
    app.use('*', createAdminRoleMiddleware())
    app.route('/admin/cleanup', createCleanupAdminRouter(handle))

    const res = await app.request('/admin/cleanup/reconcile', {
      method: 'POST',
    })
    expect(res.status).toBe(403)
    expect(handle.reconcileNow).not.toHaveBeenCalled()
  })
})
