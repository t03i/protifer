import { loadSheddingConfig } from '@protifer/shared'
import type { AuthContext } from '@protifer/shared'
import { Hono } from 'hono'
import RedisMock from 'ioredis-mock'
import { Counter, Gauge, Registry } from 'prom-client'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { createSheddingMiddleware } from './shedding.ts'
import type { SheddingMetrics } from './shedding.ts'
import { createShedingState } from '../shedding/state.ts'
import type { SheddingRedis } from '../shedding/state.ts'
import type { Variables } from '../types/hono.ts'

function makeMetrics(): SheddingMetrics {
  const registry = new Registry()
  return {
    requestsShedTotal: new Counter({
      name: 'requests_shed_total',
      help: 'test',
      labelNames: ['mode', 'plan', 'outcome', 'code'] as const,
      registers: [registry],
    }),
    shedingEstimatedWait: new Gauge({
      name: 'shedding_estimated_wait_seconds',
      help: 'test',
      registers: [registry],
    }),
    shedingResiduesPerSecond: new Gauge({
      name: 'shedding_residues_per_second',
      help: 'test',
      registers: [registry],
    }),
    shedingPendingResidues: new Gauge({
      name: 'shedding_pending_residues',
      help: 'test',
      registers: [registry],
    }),
  }
}

function makeRedis(): SheddingRedis {
  const RedisCtor = RedisMock as unknown as new () => RedisMock
  return new RedisCtor() as unknown as SheddingRedis
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

async function flushRedis(redis: SheddingRedis) {
  await (redis as unknown as { flushall: () => Promise<unknown> }).flushall()
}

function makeApp({
  env,
  redis,
  metrics,
  plan = 'free',
  auth = true,
  getResidues = (body: unknown) =>
    (body as { sequence?: string }).sequence?.length ?? 0,
  onError,
}: {
  env?: Record<string, string | undefined>
  redis: SheddingRedis
  metrics: SheddingMetrics
  plan?: AuthContext['plan']
  auth?: boolean
  getResidues?: (body: unknown) => number
  onError?: (err: unknown) => Response | Promise<Response>
}) {
  const config = loadSheddingConfig(env ?? {})
  const state = createShedingState({ redis, config })
  const middleware = createSheddingMiddleware({
    config,
    state,
    metrics,
    logger: mockLogger,
    getResidues,
  })
  const app = new Hono<{ Variables: Variables }>()
  if (auth) {
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'u1',
        email: 'u1@x.com',
        plan,
        limits: {
          submissionsPerMinute: 10,
          maxConcurrentJobs: 2,
          maxSequenceLength: 4096,
          sloSeconds: config.sloSeconds[plan],
        },
        method: 'session',
      })
      await next()
    })
  }
  app.use('*', middleware)
  app.post('/v1/predictions', (c) => c.json({ ok: true }, 202))

  if (onError) {
    app.onError((err) => Promise.resolve(onError(err)))
  } else {
    app.onError((err) => {
      const e = err as {
        statusCode?: number
        code?: string
        message?: string
        retryAfter?: number
      }
      const status = e.statusCode ?? 500
      const res = new Response(
        JSON.stringify({ error: e.message, code: e.code }),
        { status, headers: { 'content-type': 'application/json' } },
      )
      if (e.retryAfter !== undefined) {
        res.headers.set(
          'Retry-After',
          String(Math.max(0, Math.ceil(e.retryAfter))),
        )
      }
      return res
    })
  }
  return { app, state, config }
}

describe('createSheddingMiddleware', () => {
  let redis: SheddingRedis
  let metrics: SheddingMetrics

  beforeEach(async () => {
    vi.clearAllMocks()
    redis = makeRedis()
    await flushRedis(redis)
    metrics = makeMetrics()
  })

  it('SHED_ENABLED=false is a pass-through (no redis read, no metric)', async () => {
    const { app } = makeApp({
      env: { SHED_ENABLED: 'false' },
      redis,
      metrics,
    })
    const res = await app.request('/v1/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sequence: 'ABC' }),
    })
    expect(res.status).toBe(202)
    const counter = await metrics.requestsShedTotal.get()
    expect(counter.values.length).toBe(0)
  })

  it('admits within SLO and increments pending residues', async () => {
    const { app, state } = makeApp({
      env: {
        SHED_INITIAL_RESIDUES_PER_SECOND: '1000',
        SHED_SLO_FREE_SECONDS: '30',
      },
      redis,
      metrics,
      plan: 'free',
    })
    const res = await app.request('/v1/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sequence: 'A'.repeat(500) }),
    })
    expect(res.status).toBe(202)
    const snap = await state.readState()
    expect(snap.pendingResidues).toBe(500)
    const counter = await metrics.requestsShedTotal.get()
    expect(
      counter.values.find(
        (v) => v.labels.outcome === 'admit' && v.labels.plan === 'free',
      )?.value,
    ).toBe(1)
  })

  it('sheds free user in enforce mode above SLO with 503 and Retry-After', async () => {
    // Preload pending residues so wait > SLO
    const preloadConfig = loadSheddingConfig({})
    const preloadState = createShedingState({ redis, config: preloadConfig })
    await preloadState.incrementPending(60_000)
    const { app } = makeApp({
      env: {
        SHED_MODE: 'enforce',
        SHED_INITIAL_RESIDUES_PER_SECOND: '1000',
        SHED_SLO_FREE_SECONDS: '30',
      },
      redis,
      metrics,
      plan: 'free',
    })
    const res = await app.request('/v1/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sequence: 'A' }),
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('OVERLOADED')
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('shadow mode would-shed admits and records shed counter', async () => {
    const preloadConfig = loadSheddingConfig({})
    const preloadState = createShedingState({ redis, config: preloadConfig })
    await preloadState.incrementPending(60_000)
    const { app } = makeApp({
      env: {
        SHED_MODE: 'shadow',
        SHED_INITIAL_RESIDUES_PER_SECOND: '1000',
        SHED_SLO_FREE_SECONDS: '30',
      },
      redis,
      metrics,
      plan: 'free',
    })
    const res = await app.request('/v1/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sequence: 'ABC' }),
    })
    expect(res.status).toBe(202)
    const counter = await metrics.requestsShedTotal.get()
    expect(
      counter.values.find(
        (v) =>
          v.labels.mode === 'shadow' &&
          v.labels.outcome === 'shed' &&
          v.labels.code === 'OVERLOADED',
      )?.value,
    ).toBe(1)
  })

  it('enterprise SLO=0 is admitted even at heavy load', async () => {
    const preloadConfig = loadSheddingConfig({})
    const preloadState = createShedingState({ redis, config: preloadConfig })
    await preloadState.incrementPending(1_000_000)
    const { app } = makeApp({
      env: {
        SHED_MODE: 'enforce',
        SHED_SLO_ENTERPRISE_SECONDS: '0',
      },
      redis,
      metrics,
      plan: 'enterprise',
    })
    const res = await app.request('/v1/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sequence: 'ABC' }),
    })
    expect(res.status).toBe(202)
  })

  it('cache-hit short-circuit bypasses admission accounting', async () => {
    const preloadConfig = loadSheddingConfig({})
    const preloadState = createShedingState({ redis, config: preloadConfig })
    await preloadState.incrementPending(60_000) // would normally shed

    const fakeJob = { getState: vi.fn().mockResolvedValue('completed') }
    const fakeQueue = {
      getJob: vi.fn().mockResolvedValue(fakeJob),
    } as unknown as Parameters<typeof createSheddingMiddleware>[0]['queue']

    const config = loadSheddingConfig({
      SHED_MODE: 'enforce',
      SHED_INITIAL_RESIDUES_PER_SECOND: '1000',
      SHED_SLO_FREE_SECONDS: '30',
    })
    const state = createShedingState({ redis, config })
    const middleware = createSheddingMiddleware({
      config,
      state,
      metrics,
      logger: mockLogger,
      getResidues: (body) =>
        (body as { sequence?: string }).sequence?.length ?? 0,
      computeJobId: () => 'cached-job-id',
      queue: fakeQueue,
    })
    const app = new Hono<{ Variables: Variables }>()
    app.use('*', async (c, next) => {
      c.set('auth', {
        sub: 'u1',
        email: 'u1@x.com',
        plan: 'free',
        limits: {
          submissionsPerMinute: 10,
          maxConcurrentJobs: 2,
          maxSequenceLength: 4096,
          sloSeconds: config.sloSeconds.free,
        },
        method: 'session',
      })
      await next()
    })
    app.use('*', middleware)
    app.post('/v1/predictions', (c) => c.json({ ok: true }, 202))

    const res = await app.request('/v1/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sequence: 'A' }),
    })
    expect(res.status).toBe(202)
    const snapAfter = await state.readState()
    expect(snapAfter.pendingResidues).toBe(60_000) // not incremented
    const counter = await metrics.requestsShedTotal.get()
    expect(counter.values.length).toBe(0)
  })
})
