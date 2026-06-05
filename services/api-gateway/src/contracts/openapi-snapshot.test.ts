import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { OpenAPIHono } from '@hono/zod-openapi'
import type { FlowProducer, PlanResolver, Queue } from '@protifer/shared'
import { makeInMemoryStore } from '@protifer/shared'
import { describe, expect, it, vi } from 'vitest'

import type { Auth } from '../auth/index.ts'
import { createAuthenticateMiddleware } from '../middleware/auth/index.ts'
import type { RedisCommands } from '../queue.ts'
import { createEmbeddingsRouter } from '../routes/embeddings.ts'
import { createHealthRouter } from '../routes/health.ts'
import { createPredictionsRouter } from '../routes/predictions.ts'
import type { Variables } from '../types/hono.ts'

const SNAPSHOT_PATH = resolve(import.meta.dirname, '../../openapi.v1.json')

function makeSpecApp() {
  // Minimal app with all routes registered for OpenAPI spec generation.
  // No live Redis — only needs route registrations for schema extraction.
  const mockAuth = {
    api: {
      getSession: vi.fn().mockResolvedValue({
        session: {},
        user: { id: 'u1', email: 'u@test.com' },
      }),
    },
  } as unknown as Auth
  const proResolver: PlanResolver = {
    resolve: vi.fn().mockResolvedValue('pro'),
  }
  const mockQueue = {
    getJob: vi.fn().mockResolvedValue(null),
    getJobCounts: vi.fn().mockResolvedValue({ active: 0, waiting: 0 }),
  } as unknown as Queue
  const mockFlow = {
    add: vi.fn().mockResolvedValue({}),
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

  const app = new OpenAPIHono<{ Variables: Variables }>()
  app.route('/health', createHealthRouter())

  app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
  })

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description:
      'API key issued via Settings → API Keys (or `auth.api.createApiKey` server-side). Send as `Authorization: Bearer <key>`.',
  })

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'protifer API',
      version: '1.0.0',
      description:
        'Two ways to authenticate:\n\n' +
        '- **Session cookie** — [sign in with GitHub](/api/auth/sign-in/github) in this browser; subsequent requests include the cookie automatically. Best for interactive use.\n' +
        '- **Bearer API key** — issue a key from `/settings/api-keys` and send `Authorization: Bearer <key>`. Best for programmatic / CI use.',
    },
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  })

  app.use(
    '/v1/*',
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
    }),
  )
  app.route(
    '/v1/embeddings',
    createEmbeddingsRouter({
      embeddingQueue: mockQueue,
      store: mockStore,
      redis: mockRedis as RedisCommands,
    }),
  )

  return app
}

describe('CTRT-04: OpenAPI snapshot', () => {
  it('matches committed openapi.v1.json', async () => {
    const app = makeSpecApp()
    const res = await app.request('/openapi.json')
    expect(res.status).toBe(200)
    const live = (await res.json()) as Record<string, unknown>

    const liveStr = JSON.stringify(live, null, 2) + '\n'

    if (!existsSync(SNAPSHOT_PATH)) {
      writeFileSync(SNAPSHOT_PATH, liveStr)
      throw new Error(
        'openapi.v1.json was missing — wrote it. Commit the file and re-run tests.',
      )
    }

    const committedStr = readFileSync(SNAPSHOT_PATH, 'utf8')
    const committed = JSON.parse(committedStr) as Record<string, unknown>
    expect(live).toEqual(committed)
  })
})
