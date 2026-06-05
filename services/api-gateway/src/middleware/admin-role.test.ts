import { Hono } from 'hono'
import { describe, it, expect } from 'vitest'

import { createAdminRoleMiddleware } from './admin-role.ts'
import type { Variables } from '../types/hono.ts'

describe('createAdminRoleMiddleware (Phase 22 D-10)', () => {
  it('returns 401 UNAUTHORIZED when no auth context is set', async () => {
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAdminRoleMiddleware())
    app.get('/admin/queues', (c) => c.json({ ok: true }))

    const res = await app.request('/admin/queues')

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('returns 403 FORBIDDEN when auth role !== admin', async () => {
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'u1',
        email: 'u1@example.com',
        plan: 'free',
        role: 'user',
      })
      await next()
    })
    app.use('*', createAdminRoleMiddleware())
    app.get('/admin/queues', (c) => c.json({ ok: true }))

    const res = await app.request('/admin/queues')

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('returns 403 FORBIDDEN when auth has no role field at all', async () => {
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', async (c, next) => {
      c.set('auth', { sub: 'u1', email: 'u1@example.com', plan: 'free' })
      await next()
    })
    app.use('*', createAdminRoleMiddleware())
    app.get('/admin/queues', (c) => c.json({ ok: true }))

    const res = await app.request('/admin/queues')

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('passes through when auth role === admin', async () => {
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'u1',
        email: 'admin@example.com',
        plan: 'free',
        role: 'admin',
      })
      await next()
    })
    app.use('*', createAdminRoleMiddleware())
    app.get('/admin/queues', (c) => c.json({ ok: true }))

    const res = await app.request('/admin/queues')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
