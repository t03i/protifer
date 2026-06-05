/**
 * Shutdown unit test. Calls `createApp().close()` directly rather than sending
 * a real SIGTERM: the SIGTERM handler in `index.ts` is a thin wrapper around
 * `close()` + `server.stop()`, so testing `close()` in isolation confirms all
 * resources are released without spawning a subprocess.
 *
 * TODO: an integration test could spawn the gateway binary, POST a job, send
 * SIGTERM, and assert the process exits 0 within 5s.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { createApp } from './app.ts'

// Mocks — replace real I/O with stubs so tests run without infrastructure.

const mockQuit = vi.fn().mockResolvedValue('OK')
const mockConnectionInstance = {
  quit: mockQuit,
  // RedisStore constructor calls SCRIPT immediately; stub it out
  script: vi.fn().mockResolvedValue('OK'),
  // Shedding accounting subscriber uses set (NX PX) for leader acquire
  // and eval for renew/release. Stub them out so startup doesn't log errors.
  set: vi.fn().mockResolvedValue('OK'),
  eval: vi.fn().mockResolvedValue(1),
  incrby: vi.fn().mockResolvedValue(0),
  decrby: vi.fn().mockResolvedValue(0),
  get: vi.fn().mockResolvedValue(null),
  hget: vi.fn().mockResolvedValue(null),
  hset: vi.fn().mockResolvedValue(1),
  hmget: vi.fn().mockResolvedValue([null, null]),
}

const mockQueueClose = vi.fn().mockResolvedValue(undefined)
const mockQueueInstance = {
  close: mockQueueClose,
  getJob: vi.fn().mockResolvedValue(null),
  toKey: vi.fn((type: string) => `bull:mock:${type}`),
}

const mockFlowClose = vi.fn().mockResolvedValue(undefined)
const mockFlowInstance = { close: mockFlowClose }

const mockQueueEventsClose = vi.fn().mockResolvedValue(undefined)
const mockQueueEventsInstance = {
  close: mockQueueEventsClose,
  on: vi.fn(),
}

vi.mock('@protifer/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@protifer/shared')>()
  return {
    ...actual,
    createRedisConnection: vi.fn(() => mockConnectionInstance),
    createQueue: vi.fn(() => mockQueueInstance),
    createFlowProducer: vi.fn(() => mockFlowInstance),
    QueueEvents: vi.fn(() => mockQueueEventsInstance),
    defaultPinoOptions: vi.fn(() => ({})),
  }
})

// Mock pg Pool — captures end() calls for auth, plan, and userDirectory pools.

const poolEndCalls: string[] = []

vi.mock('pg', () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      end: vi.fn().mockImplementation(() => {
        poolEndCalls.push('ended')
        return Promise.resolve()
      }),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    })),
  }
})

// Mock better-auth — minimal stub so createAuth doesn't reach out.

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn() })),
}))

vi.mock('@better-auth/api-key', () => ({
  apiKey: vi.fn(() => ({})),
}))

// Mock rate-limit-redis — RedisStore constructor calls SCRIPT immediately;
// stub the whole module so the RedisStore never touches the connection stub.
vi.mock('rate-limit-redis', () => ({
  // hono-rate-limiter validates that the store exposes these three methods.
  RedisStore: vi.fn().mockImplementation(() => ({
    increment: vi
      .fn()
      .mockResolvedValue({ totalHits: 0, resetTime: undefined }),
    decrement: vi.fn().mockResolvedValue(undefined),
    resetKey: vi.fn().mockResolvedValue(undefined),
  })),
}))

const mockTritonClose = vi.fn()
vi.mock('@protifer/triton-client', () => ({
  createTritonClient: vi.fn(() => ({
    serverReady: vi.fn().mockResolvedValue(true),
    modelInfer: vi.fn(),
    close: mockTritonClose,
  })),
}))

describe('createApp().close() — graceful shutdown (P4-10 / P4-11)', () => {
  beforeEach(() => {
    poolEndCalls.length = 0
    mockQuit.mockClear()
    mockQueueClose.mockClear()
    mockFlowClose.mockClear()
    mockQueueEventsClose.mockClear()
  })

  it('close() resolves without throwing', async () => {
    const { close } = createApp({
      connection: mockConnectionInstance as never,
    })
    await expect(close()).resolves.toBeUndefined()
  })

  it('close() closes both BullMQ queues', async () => {
    const { close } = createApp({
      connection: mockConnectionInstance as never,
    })
    await close()
    // embeddingQueue.close + predictionQueue.close
    expect(mockQueueClose).toHaveBeenCalledTimes(2)
  })

  it('close() closes the FlowProducer', async () => {
    const { close } = createApp({
      connection: mockConnectionInstance as never,
    })
    await close()
    expect(mockFlowClose).toHaveBeenCalledOnce()
  })

  it('close() closes QueueEvents (cleanup handle)', async () => {
    const { close } = createApp({
      connection: mockConnectionInstance as never,
    })
    await close()
    // predictionEvents + embeddingEvents
    expect(mockQueueEventsClose).toHaveBeenCalledTimes(2)
  })

  it('close() calls quit() on the Redis connection', async () => {
    const { close } = createApp({
      connection: mockConnectionInstance as never,
    })
    await close()
    expect(mockQuit).toHaveBeenCalledOnce()
  })

  it('close() ends the shared pg Pool', async () => {
    const { close } = createApp({
      connection: mockConnectionInstance as never,
    })
    await close()
    // One sharedPool backs auth + plan + userDirectory + the /ready probe.
    expect(poolEndCalls.length).toBeGreaterThanOrEqual(1)
  })
})
