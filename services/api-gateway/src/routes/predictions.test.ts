import { OpenAPIHono } from '@hono/zod-openapi'
import type { FlowProducer, PlanResolver, Queue } from '@protifer/shared'
import { makeInMemoryStore, predictionRefKey } from '@protifer/shared'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { createPredictionsRouter } from './predictions.ts'
import type { Auth } from '../auth/index.ts'
import { ConfigSchema, TEST_ENV } from '../config/schema.ts'
import { buildSuiteV1 } from '../config/suites.ts'
import { createAuthenticateMiddleware } from '../middleware/auth/index.ts'
import type { RedisCommands } from '../queue.ts'
import { PredictionPollResponseSchema } from '../schemas/predictions.ts'
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

const mockQueue = {
  getJob: vi.fn().mockResolvedValue(null),
  getJobCounts: vi.fn().mockResolvedValue({ active: 0, waiting: 0 }),
} as unknown as Queue

const mockFlowAdd = vi.fn().mockResolvedValue({})
const mockFlow = {
  add: mockFlowAdd,
} as unknown as FlowProducer

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
    '/v1/predictions',
    createPredictionsRouter({
      embeddingQueue: mockQueue,
      predictionQueue: mockQueue,
      flowProducer: mockFlow,
      store: mockStore,
      redis: mockRedis as RedisCommands,
      suite: buildSuiteV1(ConfigSchema.load(TEST_ENV).models),
    }),
  )
  return app
}

describe('PredictionPollResponseSchema', () => {
  it('accepts a complete response including result', () => {
    const input = {
      status: 'complete',
      jobId: 'abc123',
      result: {
        schemaVersion: 1,
        versions: [],
        outputs: { tmbed: 'iii' },
      },
      embeddingModel: { name: 'prott5_xl_u50', version: 'v1' },
      cachedAt: '2024-01-01T00:00:00Z',
    }
    const parsed = PredictionPollResponseSchema.safeParse(input)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.result).toBeDefined()
    }
  })
})

describe('POST /v1/predictions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 for missing sequence', async () => {
    const res = await makeApp().request('/v1/predictions', {
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
    const res = await makeApp().request('/v1/predictions', {
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
    const res = await makeApp().request('/v1/predictions', {
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
    expect(mockFlowAdd).toHaveBeenCalledOnce()
    const call = mockFlowAdd.mock.calls[0] as [
      { children: Array<{ opts: Record<string, unknown> }> },
    ]
    expect(call[0].children[0].opts).toHaveProperty('failParentOnFailure', true)
  })

  it('writes job-user-map entry on submission', async () => {
    const res = await makeApp().request('/v1/predictions', {
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

  it('returns 429 with X-RateLimit-Concurrent when concurrent cap is reached', async () => {
    mockRedis.zcard.mockResolvedValueOnce(10)

    const res = await makeApp().request('/v1/predictions', {
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
    expect(res.headers.get('x-ratelimit-concurrent')).toBe('10')
    expect(mockFlowAdd).not.toHaveBeenCalled()
  })

  it('does not re-enqueue an existing active job', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'existing-job',
      getState: vi.fn().mockResolvedValue('active'),
    })

    const res = await makeApp().request('/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({ sequence: 'MKTVRQERLK' }),
    })

    expect(res.status).toBe(202)
    expect(mockFlowAdd).not.toHaveBeenCalled()
  })
})

describe('GET /v1/predictions/:jobId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    mockAuth.api.getSession = vi.fn().mockResolvedValue({
      session: {},
      user: { id: 'user-001', email: 'user@example.com' },
    })
    proResolver.resolve = vi.fn().mockResolvedValue('pro')
  })

  it('returns 404 when job does not exist', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const res = await makeApp().request('/v1/predictions/pred_unknown', {
      headers: {
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(404)
    expect(body.status).toBe('not_found')
  })

  it('returns failed when the BullMQ job itself failed', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('failed'),
      data: { userId: 'user-001' },
      failedReason: 'Worker OOM',
    })

    const res = await makeApp().request('/v1/predictions/pred_failed', {
      headers: {
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.status).toBe('failed')
    expect(body.error).toBe('Prediction failed')
    expect(body.code).toBe('PREDICTION_FAILED')
    // raw worker reason must not leak to clients
    expect(JSON.stringify(body)).not.toContain('Worker OOM')
  })

  it('returns queued when embedding job is waiting', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('waiting'),
        data: {
          sequence: 'MAAA',
          sequenceHash: 'abc',
          embeddingModel: { name: 'prott5_xl_u50', version: '1' },
          predictionModels: [],
          userId: 'user-001',
          submittedAt: new Date().toISOString(),
        },
        failedReason: undefined,
      })
      .mockResolvedValueOnce(null) // embeddingQueue null → embState "waiting"

    const res = await makeApp().request('/v1/predictions/pred_queued', {
      headers: {
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(202)
    expect(body.status).toBe('queued')
  })

  it('returns processing when prediction job is active', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('active'),
        data: {
          sequence: 'MAAA',
          sequenceHash: 'abc',
          embeddingModel: { name: 'prott5_xl_u50', version: '1' },
          predictionModels: [],
          userId: 'user-001',
          submittedAt: new Date().toISOString(),
        },
        failedReason: undefined,
      })
      .mockResolvedValueOnce(null)

    const res = await makeApp().request('/v1/predictions/pred_active', {
      headers: {
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(202)
    expect(body.status).toBe('processing')
  })

  it('returns complete with result when job is completed and result exists in store', async () => {
    const embeddingModel = { name: 'prott5_xl_u50' as const, version: '1' }
    const predictionModels = [{ name: 'tmbed' as const, version: '1' }]
    const sequenceHash = 'testhash123'
    const predRef = predictionRefKey(
      embeddingModel,
      predictionModels,
      sequenceHash,
    )
    const storedResult = {
      schemaVersion: 1,
      versions: [],
      outputs: { tmbed: 'oooTTTooo' },
    }
    await mockStore.put(predRef, Buffer.from(JSON.stringify(storedResult)))
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('completed'),
      data: {
        sequence: 'MAAA',
        sequenceHash,
        embeddingModel,
        predictionModels,
        userId: 'user-001',
        submittedAt: new Date().toISOString(),
      },
      failedReason: undefined,
    })

    const res = await makeApp().request('/v1/predictions/pred_complete', {
      headers: {
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.status).toBe('complete')
    expect(body.result).toEqual(storedResult)
    expect(body.embeddingModel).toEqual(embeddingModel)
    expect(body.cachedAt).toBeDefined()

    await mockStore.put(predRef, Buffer.from('{}'))
  })

  it('returns failed when job is completed but result is missing from store', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('completed'),
      data: {
        sequence: 'MAAA',
        sequenceHash: 'abc',
        embeddingModel: { name: 'prott5_xl_u50', version: '1' },
        predictionModels: [],
        userId: 'user-001',
        submittedAt: new Date().toISOString(),
      },
      failedReason: undefined,
    })
    vi.spyOn(mockStore, 'exists').mockResolvedValueOnce(false)

    const res = await makeApp().request('/v1/predictions/pred_missing', {
      headers: {
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.status).toBe('failed')
    expect(body.error).toMatch(/not found in store/)
  })

  it('returns embedding-origin error for cascaded child failure', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('failed'),
        data: {
          sequence: 'MAAA',
          sequenceHash: 'abc',
          embeddingModel: { name: 'prott5_xl_u50', version: '1' },
          predictionModels: [],
          userId: 'user-001',
          submittedAt: new Date().toISOString(),
        },
        failedReason: 'child embedding:emb-abc123 failed',
      })
      .mockResolvedValueOnce({
        failedReason: 'Triton connection refused',
      })

    const res = await makeApp().request('/v1/predictions/pred_cascaded', {
      headers: {
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.status).toBe('failed')
    expect(body.error).toBe('Embedding failed')
    expect(body.code).toBe('EMBEDDING_FAILED')
    // raw child reason must not leak to clients
    expect(JSON.stringify(body)).not.toContain('Triton connection refused')
  })

  it('returns generic embedding error when child job is evicted', async () => {
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('failed'),
        data: {
          sequence: 'MAAA',
          sequenceHash: 'abc',
          embeddingModel: { name: 'prott5_xl_u50', version: '1' },
          predictionModels: [],
          userId: 'user-001',
          submittedAt: new Date().toISOString(),
        },
        failedReason: 'child embedding:emb-abc123 failed',
      })
      .mockResolvedValueOnce(null)

    const res = await makeApp().request('/v1/predictions/pred_evicted', {
      headers: {
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.status).toBe('failed')
    expect(body.error).toBe('Embedding failed')
    expect(body.code).toBe('EMBEDDING_FAILED')
  })

  // IDOR ownership tests
  it('owner polls own prediction job → normal status (not 404)', async () => {
    // Session user is user-001; job.data.userId is also user-001 → allowed.
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('active'),
        data: {
          sequence: 'MAAA',
          sequenceHash: 'abc',
          embeddingModel: { name: 'prott5_xl_u50', version: '1' },
          predictionModels: [],
          userId: 'user-001',
          submittedAt: new Date().toISOString(),
        },
        failedReason: undefined,
      })
      .mockResolvedValueOnce(null)

    const res = await makeApp().request('/v1/predictions/pred_owner', {})
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(202)
    expect(body.status).toBe('processing')
  })

  it("different user polls another user's prediction job → 404 (P4-02 IDOR)", async () => {
    // Session user is user-001; job belongs to other-user → must return 404.
    ;(mockQueue.getJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('active'),
      data: {
        sequence: 'MAAA',
        sequenceHash: 'abc',
        embeddingModel: { name: 'prott5_xl_u50', version: '1' },
        predictionModels: [],
        userId: 'other-user',
        submittedAt: new Date().toISOString(),
      },
      failedReason: undefined,
    })

    const res = await makeApp().request('/v1/predictions/pred_idor', {})
    const body = (await res.json()) as Record<string, unknown>

    // Must be 404 (not 200/202/403) to avoid disclosing job existence.
    expect(res.status).toBe(404)
    expect(body.status).toBe('not_found')
  })
})
