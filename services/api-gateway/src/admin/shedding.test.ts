import { loadSheddingConfig } from '@protifer/shared'
import { Hono } from 'hono'
import RedisMock from 'ioredis-mock'
import { describe, it, expect, beforeEach } from 'vitest'

import { createSheddingAdminRouter } from './shedding.ts'
import { createAdminRoleMiddleware } from '../middleware/admin-role.ts'
import { createShedingState } from '../shedding/state.ts'
import type { SheddingRedis } from '../shedding/state.ts'
import type { Variables } from '../types/hono.ts'

function makeRedis(): SheddingRedis {
  const RedisCtor = RedisMock as unknown as new () => RedisMock
  return new RedisCtor() as unknown as SheddingRedis
}

describe('createSheddingAdminRouter', () => {
  let redis: SheddingRedis
  beforeEach(async () => {
    redis = makeRedis()
    await (redis as unknown as { flushall: () => Promise<unknown> }).flushall()
  })

  it('admin role receives 200 with expected state shape', async () => {
    const config = loadSheddingConfig({})
    const state = createShedingState({ redis, config })
    await state.incrementPending(1500)

    const app = new Hono<{ Variables: Variables }>()
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'u1',
        email: 'a@x.com',
        plan: 'enterprise',
        role: 'admin',
      })
      await next()
    })
    app.use('*', createAdminRoleMiddleware())
    app.route('/admin/shedding', createSheddingAdminRouter({ state, config }))

    const res = await app.request('/admin/shedding/state')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      pendingResidues: number
      residuesPerSecondEwma: number
      estimatedWaitSeconds: number
      mode: string
      enabled: boolean
      slo: { free: number; pro: number; enterprise: number }
      priority: { free: number; pro: number; enterprise: number }
    }
    expect(body.pendingResidues).toBe(1500)
    expect(body.mode).toBe(config.mode)
    expect(body.enabled).toBe(config.enabled)
    expect(body.slo).toEqual(config.sloSeconds)
    expect(body.priority).toEqual(config.priority)
    expect(body.estimatedWaitSeconds).toBeGreaterThan(0)
  })

  it('non-admin authenticated user receives 403', async () => {
    const config = loadSheddingConfig({})
    const state = createShedingState({ redis, config })
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'u1',
        email: 'a@x.com',
        plan: 'free',
        role: 'user',
      })
      await next()
    })
    app.use('*', createAdminRoleMiddleware())
    app.route('/admin/shedding', createSheddingAdminRouter({ state, config }))

    const res = await app.request('/admin/shedding/state')
    expect(res.status).toBe(403)
  })

  it('unauthenticated request receives 401', async () => {
    const config = loadSheddingConfig({})
    const state = createShedingState({ redis, config })
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', createAdminRoleMiddleware())
    app.route('/admin/shedding', createSheddingAdminRouter({ state, config }))

    const res = await app.request('/admin/shedding/state')
    expect(res.status).toBe(401)
  })
})
