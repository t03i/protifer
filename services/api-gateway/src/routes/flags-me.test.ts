import { defineFlags, InMemoryFlagOverrideStore } from '@protifer/shared'
import type { FlagRegistry } from '@protifer/shared'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createFlagsMeRouter } from './flags-me.ts'
import type { Variables } from '../types/hono.ts'

const baseDef = {
  description: 'x',
  owner: 'p',
  createdAt: '2026-01-01',
  expiresAt: '2027-01-01',
} as const

const registry = defineFlags({
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
})

function makeApp(opts: {
  store: InMemoryFlagOverrideStore
  plan?: 'free' | 'pro' | 'enterprise'
  userId?: string
  clock?: { now(): number }
  cacheMaxEntries?: number
  reg?: FlagRegistry
}) {
  const app = new Hono<{ Variables: Variables }>()
  app.use('*', async (c, next) => {
    c.set('auth', {
      sub: opts.userId ?? 'u1',
      email: 'u@x.com',
      plan: opts.plan ?? 'free',
      role: 'user',
    })
    await next()
  })
  app.route(
    '/v1/flags/me',
    createFlagsMeRouter({
      registry: opts.reg ?? registry,
      store: opts.store,
      clock: opts.clock,
      cacheMaxEntries: opts.cacheMaxEntries,
    }),
  )
  return app
}

function makeMultiUserApp(opts: {
  store: InMemoryFlagOverrideStore
  cacheMaxEntries: number
  clock?: { now(): number }
}) {
  let currentSub = 'u1'
  const app = new Hono<{ Variables: Variables }>()
  app.use('*', async (c, next) => {
    c.set('auth', {
      sub: currentSub,
      email: `${currentSub}@x.com`,
      plan: 'free',
      role: 'user',
    })
    await next()
  })
  app.route(
    '/v1/flags/me',
    createFlagsMeRouter({
      registry,
      store: opts.store,
      clock: opts.clock,
      cacheMaxEntries: opts.cacheMaxEntries,
    }),
  )
  return {
    request: (sub: string) => {
      currentSub = sub
      return app.request('/v1/flags/me')
    },
  }
}

describe('GET /v1/flags/me', () => {
  let store: InMemoryFlagOverrideStore
  beforeEach(() => {
    store = new InMemoryFlagOverrideStore()
  })

  it('returns evaluated defaults for every registry flag', async () => {
    const res = await makeApp({ store }).request('/v1/flags/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      evaluatedFlags: Record<string, unknown>
    }
    expect(body.evaluatedFlags).toEqual({
      'global.bool': false,
      'plan.bool': false,
    })
  })

  it('reflects overrides set via the store', async () => {
    await store.set('global.bool', { value: true }, 'admin')
    const res = await makeApp({ store }).request('/v1/flags/me')
    const body = (await res.json()) as {
      evaluatedFlags: Record<string, unknown>
    }
    expect(body.evaluatedFlags['global.bool']).toBe(true)
  })

  it('reflects per-plan targeting per user', async () => {
    await store.set(
      'plan.bool',
      { perPlan: { free: false, pro: true, enterprise: true } },
      'admin',
    )
    const free = await makeApp({ store, plan: 'free' }).request('/v1/flags/me')
    const pro = await makeApp({ store, plan: 'pro' }).request('/v1/flags/me')
    const freeBody = (await free.json()) as {
      evaluatedFlags: Record<string, unknown>
    }
    const proBody = (await pro.json()) as {
      evaluatedFlags: Record<string, unknown>
    }
    expect(freeBody.evaluatedFlags['plan.bool']).toBe(false)
    expect(proBody.evaluatedFlags['plan.bool']).toBe(true)
  })

  it('caches per-user evaluation within ttl', async () => {
    let now = 1_000
    const clock = { now: () => now }
    const app = makeApp({ store, clock })

    await app.request('/v1/flags/me')
    await store.set('global.bool', { value: true }, 'admin')
    now += 1_000

    const res = await app.request('/v1/flags/me')
    const body = (await res.json()) as {
      evaluatedFlags: Record<string, unknown>
    }
    expect(body.evaluatedFlags['global.bool']).toBe(false)

    now += 5_000
    const res2 = await app.request('/v1/flags/me')
    const body2 = (await res2.json()) as {
      evaluatedFlags: Record<string, unknown>
    }
    expect(body2.evaluatedFlags['global.bool']).toBe(true)
  })

  it('evicts least-recently-used entries past cacheMaxEntries', async () => {
    // Stable clock keeps every entry "fresh" — eviction is solely size-based.
    const clock = { now: () => 1_000 }
    const driver = makeMultiUserApp({ store, cacheMaxEntries: 2, clock })

    // Warm cache with 2 distinct users (cap = 2).
    await driver.request('u1')
    await driver.request('u2')

    // Bump u1 to MRU, then admit u3 → should evict u2 (LRU), not u1.
    await driver.request('u1')
    await driver.request('u3')

    // Force a store-side change; cached users should still see the old value,
    // evicted user (u2) should re-fetch and observe it.
    const spy = vi.spyOn(store, 'get')
    spy.mockClear()

    await driver.request('u1') // hit
    await driver.request('u3') // hit
    expect(spy).not.toHaveBeenCalled()

    await driver.request('u2') // evicted earlier — must re-fetch
    expect(spy).toHaveBeenCalled()
  })
})
