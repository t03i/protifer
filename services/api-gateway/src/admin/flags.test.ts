import { defineFlags, InMemoryFlagOverrideStore } from '@protifer/shared'
import type { AuthContext } from '@protifer/shared'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createFlagsAdminRouter } from './flags.ts'
import { createAdminRoleMiddleware } from '../middleware/admin-role.ts'
import type { Variables } from '../types/hono.ts'

const baseDef = {
  description: 'x',
  owner: 'p',
  createdAt: '2026-01-01',
  expiresAt: '2027-01-01',
} as const

function buildRegistry() {
  return defineFlags({
    'global.bool': {
      ...baseDef,
      type: z.boolean(),
      default: false,
      targeting: 'global' as const,
    },
    'plan.bool': {
      ...baseDef,
      type: z.boolean(),
      default: false,
      targeting: 'plan' as const,
    },
    'pct.bool': {
      ...baseDef,
      type: z.boolean(),
      default: false,
      targeting: 'percentage' as const,
    },
  })
}

function makeApp(opts: {
  auth?: Partial<AuthContext> | null
  store?: InMemoryFlagOverrideStore
}) {
  const store = opts.store ?? new InMemoryFlagOverrideStore()
  const app = new Hono<{ Variables: Variables }>()
  if (opts.auth !== null) {
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'admin1',
        email: 'admin@x.com',
        plan: 'enterprise',
        role: 'admin',
        ...opts.auth,
      })
      await next()
    })
  }
  app.use('*', createAdminRoleMiddleware())
  app.route(
    '/admin/flags',
    createFlagsAdminRouter({ registry: buildRegistry(), store }),
  )
  return { app, store }
}

describe('createFlagsAdminRouter', () => {
  let store: InMemoryFlagOverrideStore
  beforeEach(() => {
    store = new InMemoryFlagOverrideStore()
  })

  it('GET / returns 200 with all flags for admin', async () => {
    const { app } = makeApp({ store })
    const res = await app.request('/admin/flags')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { flags: { name: string }[] }
    expect(body.flags.map((f) => f.name).sort()).toEqual([
      'global.bool',
      'pct.bool',
      'plan.bool',
    ])
  })

  it('GET / returns 403 for non-admin', async () => {
    const { app } = makeApp({ store, auth: { role: 'user' } })
    const res = await app.request('/admin/flags')
    expect(res.status).toBe(403)
  })

  it('PUT /:name sets a global override', async () => {
    const { app } = makeApp({ store })
    const res = await app.request('/admin/flags/global.bool', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: true }),
    })
    expect(res.status).toBe(200)
    const persisted = await store.get('global.bool')
    expect(persisted?.override).toEqual({ value: true })
    expect(persisted?.updatedBy).toBe('admin@x.com')
  })

  it('PUT /:name returns 400 on type mismatch', async () => {
    const { app } = makeApp({ store })
    const res = await app.request('/admin/flags/global.bool', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'yes' }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT /:name returns 404 for unknown flag', async () => {
    const { app } = makeApp({ store })
    const res = await app.request('/admin/flags/no.such', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: true }),
    })
    expect(res.status).toBe(404)
  })

  it('PUT /:name rejects shape mismatch (global flag with perPlan body)', async () => {
    const { app } = makeApp({ store })
    const res = await app.request('/admin/flags/global.bool', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ perPlan: { free: true } }),
    })
    expect(res.status).toBe(400)
  })

  it('DELETE /:name clears the override and reports default', async () => {
    await store.set('global.bool', { value: true }, 'admin@x.com')
    const { app } = makeApp({ store })
    const res = await app.request('/admin/flags/global.bool', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { revertedTo: unknown }
    expect(body.revertedTo).toBe(false)
    expect(await store.get('global.bool')).toBeNull()
  })

  it('GET /:name/evaluate returns plan-targeted resolution', async () => {
    await store.set(
      'plan.bool',
      { perPlan: { free: false, pro: true, enterprise: true } },
      'admin@x.com',
    )
    const { app } = makeApp({ store })
    const res = await app.request(
      '/admin/flags/plan.bool/evaluate?userId=u1&plan=pro',
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      value: unknown
      usingOverride: boolean
    }
    expect(body.value).toBe(true)
    expect(body.usingOverride).toBe(true)
  })

  it('GET /:name/evaluate falls back to default when no override', async () => {
    const { app } = makeApp({ store })
    const res = await app.request('/admin/flags/global.bool/evaluate')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      value: unknown
      usingOverride: boolean
    }
    expect(body.value).toBe(false)
    expect(body.usingOverride).toBe(false)
  })
})
