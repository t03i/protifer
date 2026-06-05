import { OpenAPIHono } from '@hono/zod-openapi'
import type { PlanResolver, Queue } from '@protifer/shared'
import { makeInMemoryStore } from '@protifer/shared'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { createEmbeddingsRouter } from './embeddings.ts'
import type { Auth } from '../auth/index.ts'
import { ConfigSchema, TEST_ENV } from '../config/schema.ts'
import { buildSuiteV1 } from '../config/suites.ts'
import { createAuthenticateMiddleware } from '../middleware/auth/index.ts'
import type { RedisCommands } from '../queue.ts'
import type { Variables } from '../types/hono.ts'

const proResolver: PlanResolver = { resolve: vi.fn().mockResolvedValue('pro') }

const mockAuth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      session: {},
      user: { id: 'user-001', email: 'user@example.com' },
    }),
  },
} as unknown as Auth

const mockQueueAdd = vi.fn().mockResolvedValue({})
const mockQueue = {
  getJob: vi.fn().mockResolvedValue(null),
  add: mockQueueAdd,
} as unknown as Queue

const mockStore = makeInMemoryStore()

const mockRedis = {
  zcard: vi.fn().mockResolvedValue(0),
  zadd: vi.fn().mockResolvedValue(1),
  zrem: vi.fn().mockResolvedValue(1),
  hset: vi.fn().mockResolvedValue(1),
  hget: vi.fn().mockResolvedValue(null),
  hdel: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
}

function makeApp() {
  const app = new OpenAPIHono<{ Variables: Variables }>()
  app.use(
    '*',
    createAuthenticateMiddleware({ auth: mockAuth, resolver: proResolver }),
  )
  app.route(
    '/v1/embeddings',
    createEmbeddingsRouter({
      embeddingQueue: mockQueue,
      store: mockStore,
      redis: mockRedis as RedisCommands,
      suite: buildSuiteV1(ConfigSchema.load(TEST_ENV).models),
    }),
  )
  return app
}

describe('POST /v1/embeddings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 for missing sequence', async () => {
    const res = await makeApp().request('/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty sequence', async () => {
    const res = await makeApp().request('/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({ sequence: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 202 with jobId and statusUrl for valid sequence', async () => {
    const res = await makeApp().request('/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({ sequence: 'MKTVRQERLK' }),
    })
    expect(res.status).toBe(202)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('jobId')
    expect(body).toHaveProperty('statusUrl')
    expect(mockQueueAdd).toHaveBeenCalledOnce()
  })

  it('writes job-user-map entry on submission', async () => {
    const res = await makeApp().request('/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({ sequence: 'MKTVRQERLK' }),
    })
    expect(res.status).toBe(202)
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'job-user-map',
      expect.any(String),
      'user-001',
    )
    expect(mockRedis.expire).toHaveBeenCalled()
  })

  it('returns 429 when concurrent cap is reached', async () => {
    mockRedis.zcard.mockResolvedValueOnce(10)

    const res = await makeApp().request('/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({ sequence: 'MKTVRQERLK' }),
    })

    expect(res.status).toBe(429)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('does not re-enqueue an existing non-failed job', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'existing-job',
      getState: vi.fn().mockResolvedValue('active'),
    })

    const res = await makeApp().request('/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({ sequence: 'MKTVRQERLK' }),
    })

    expect(res.status).toBe(202)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})
