import { OpenAPIHono } from '@hono/zod-openapi'
import type { FlowProducer, PlanResolver, Queue } from '@protifer/shared'
import {
  EmbeddingJobDataSchema,
  PredictionJobDataSchema,
  makeInMemoryStore,
} from '@protifer/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Auth } from '../auth/index.ts'
import { ConfigSchema, TEST_ENV } from '../config/schema.ts'
import { resolveSuiteFromConfig } from '../config/suites.ts'
import { createAuthenticateMiddleware } from '../middleware/auth/index.ts'
import type { RedisCommands } from '../queue.ts'
import { createPredictionsRouter } from '../routes/predictions.ts'
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
const mockFlow = { add: mockFlowAdd } as unknown as FlowProducer
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
      suite: resolveSuiteFromConfig(ConfigSchema.load(TEST_ENV).models),
    }),
  )
  return app
}

describe('CTRT-03: Gateway → Worker job data contracts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('PredictionJobData passed to FlowProducer.add() validates against shared schema', async () => {
    const app = makeApp()
    const res = await app.request('/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({ sequence: 'MKTVRQERLK' }),
    })

    expect(res.status).toBe(202)
    expect(mockFlowAdd).toHaveBeenCalledOnce()

    const flowCall = mockFlowAdd.mock.calls[0][0] as {
      data: unknown
      children: Array<{ data: unknown }>
    }

    const predParsed = PredictionJobDataSchema.safeParse(flowCall.data)
    expect(predParsed.success).toBe(true)
    if (predParsed.success) {
      expect(predParsed.data.sequence).toBe('MKTVRQERLK')
      expect(predParsed.data.userId).toBe('user-001')
      expect(predParsed.data.predictionModels).toBeDefined()
      expect(Array.isArray(predParsed.data.predictionModels)).toBe(true)
    }
  })

  it('EmbeddingJobData passed as child to FlowProducer.add() validates against shared schema', async () => {
    const app = makeApp()
    const res = await app.request('/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Request-User': 'u1',
        'X-Auth-Request-Email': 'u@test.com',
      },
      body: JSON.stringify({ sequence: 'MKTVRQERLK' }),
    })

    expect(res.status).toBe(202)

    const flowCall = mockFlowAdd.mock.calls[0][0] as {
      data: unknown
      children: Array<{ data: unknown }>
    }

    expect(flowCall.children).toBeDefined()
    expect(flowCall.children.length).toBeGreaterThan(0)

    const embParsed = EmbeddingJobDataSchema.safeParse(
      flowCall.children[0].data,
    )
    expect(embParsed.success).toBe(true)
    if (embParsed.success) {
      expect(embParsed.data.sequence).toBe('MKTVRQERLK')
      expect(embParsed.data.userId).toBe('user-001')
      expect(embParsed.data.embeddingModel).toBeDefined()
      expect(embParsed.data.embeddingModel.name).toBeDefined()
    }
  })

  it('job data schemas reject payloads missing required fields', () => {
    // Validates that the schemas would catch drift if gateway stopped sending required fields
    const incompletePred = PredictionJobDataSchema.safeParse({
      sequence: 'MKTVRQERLK',
      // missing sequenceHash, embeddingModel, predictionModels, userId, submittedAt
    })
    expect(incompletePred.success).toBe(false)

    const incompleteEmb = EmbeddingJobDataSchema.safeParse({
      sequence: 'MKTVRQERLK',
      // missing sequenceHash, embeddingModel, userId, submittedAt
    })
    expect(incompleteEmb.success).toBe(false)
  })
})
