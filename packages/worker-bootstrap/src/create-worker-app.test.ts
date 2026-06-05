import {
  WORKER_DEFAULTS,
  QUEUE_RATE_LIMIT_MAX,
  QUEUE_RATE_LIMIT_DURATION_MS,
  WORKER_CONCURRENCY,
  getCorrelation,
} from '@protifer/shared'
import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  createWorkerApp,
  deriveTraceIdFromRequestId,
} from './create-worker-app.ts'

afterEach(() => {
  process.removeAllListeners('SIGTERM')
})

function makeTritonStub(modelReady = vi.fn().mockResolvedValue(true)): {
  modelReady: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
} {
  return { modelReady, close: vi.fn() }
}

function makeWorkerStub(): {
  run: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
} {
  return {
    run: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }
}

describe('createWorkerApp', () => {
  it('probes ModelReady for every model, starts the worker, and registers SIGTERM', async () => {
    const triton = makeTritonStub()
    const processor = vi.fn().mockResolvedValue({ ok: true })
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)
    const exit = vi.fn()

    await createWorkerApp({
      name: 'embedding',
      queueName: 'embedding',
      models: ['m1', 'm2'],
      processor,
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: exit as never,
    })

    expect(triton.modelReady).toHaveBeenCalledTimes(2)
    expect(triton.modelReady).toHaveBeenNthCalledWith(1, 'm1')
    expect(triton.modelReady).toHaveBeenNthCalledWith(2, 'm2')
    expect(workerStub.run).toHaveBeenCalledOnce()
    expect(workerStub.on).toHaveBeenCalledWith(
      'completed',
      expect.any(Function),
    )
    expect(workerStub.on).toHaveBeenCalledWith('failed', expect.any(Function))
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits(1) if any ModelReady probe returns false', async () => {
    const triton = makeTritonStub(
      vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    )
    const processor = vi.fn()
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)
    const exit = vi.fn((code: number) => {
      throw new Error(`exit ${String(code)}`)
    })

    await expect(
      createWorkerApp({
        name: 'x',
        queueName: 'embedding',
        models: ['m1', 'm2'],
        processor,
        triton: triton as never,
        createWorker: createWorker as never,
        createConnection: () => ({}) as never,
        exit: exit as never,
      }),
    ).rejects.toThrow('exit 1')
    expect(exit).toHaveBeenCalledWith(1)
    expect(workerStub.run).not.toHaveBeenCalled()
  })

  it('exits(1) when ModelReady throws', async () => {
    const triton = makeTritonStub(
      vi.fn().mockRejectedValue(new Error('grpc connect refused')),
    )
    const processor = vi.fn()
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)
    const exit = vi.fn((code: number) => {
      throw new Error(`exit ${String(code)}`)
    })

    await expect(
      createWorkerApp({
        name: 'x',
        queueName: 'prediction',
        models: ['m1'],
        processor,
        triton: triton as never,
        createWorker: createWorker as never,
        createConnection: () => ({}) as never,
        exit: exit as never,
      }),
    ).rejects.toThrow('exit 1')
    expect(exit).toHaveBeenCalledWith(1)
    expect(workerStub.run).not.toHaveBeenCalled()
  })

  it('probes models in the order provided', async () => {
    const order: string[] = []
    const triton = makeTritonStub(
      vi.fn().mockImplementation((name: string) => {
        order.push(name)
        return Promise.resolve(true)
      }),
    )
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)

    await createWorkerApp({
      name: 'x',
      queueName: 'prediction',
      models: ['a', 'b', 'c'],
      processor: vi.fn(),
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: vi.fn() as never,
    })

    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('binds an error handler on the worker (P4-09)', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)

    await createWorkerApp({
      name: 'embedding',
      queueName: 'embedding',
      models: ['m1'],
      processor: vi.fn(),
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: vi.fn() as never,
      registerSigterm: false,
    })

    expect(workerStub.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('does not register SIGTERM when registerSigterm is false', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)
    const processListenerCountBefore = process.listenerCount('SIGTERM')

    await createWorkerApp({
      name: 'x',
      queueName: 'embedding',
      models: ['m1'],
      processor: vi.fn(),
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: vi.fn() as never,
      registerSigterm: false,
    })

    expect(process.listenerCount('SIGTERM')).toBe(processListenerCountBefore)
  })

  it('on SIGTERM closes the worker, the Redis connection, and Triton', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)
    const connection = {
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
    }
    const exit = vi.fn()

    await createWorkerApp({
      name: 'x',
      queueName: 'embedding',
      models: ['m1'],
      processor: vi.fn(),
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => connection as never,
      exit: exit as never,
    })

    const sigtermListeners = process.listeners('SIGTERM')
    const handler = sigtermListeners[sigtermListeners.length - 1]
    expect(handler).toBeDefined()
    handler?.('SIGTERM')
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0)
    })

    expect(workerStub.close).toHaveBeenCalledOnce()
    expect(connection.quit).toHaveBeenCalledOnce()
    expect(triton.close).toHaveBeenCalledOnce()
  })

  it('passes WORKER_DEFAULTS limiter config to the worker constructor (P2-15)', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)

    await createWorkerApp({
      name: 'embedding',
      queueName: 'embedding',
      models: ['m1'],
      processor: vi.fn(),
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: vi.fn() as never,
      registerSigterm: false,
    })

    // The 4th arg to createWorker must NOT re-specify limiter; it comes from
    // WORKER_DEFAULTS. Verify the defaults carry the expected values so that
    // both the constants and the merged worker config stay in sync.
    expect(WORKER_DEFAULTS.limiter).toEqual({
      max: QUEUE_RATE_LIMIT_MAX,
      duration: QUEUE_RATE_LIMIT_DURATION_MS,
    })
    expect(WORKER_DEFAULTS.concurrency).toBe(WORKER_CONCURRENCY)
    // Invariant: per-worker concurrency must not exceed the queue-wide rate cap.
    expect(WORKER_CONCURRENCY).toBeLessThanOrEqual(QUEUE_RATE_LIMIT_MAX)
    // createWorker called without an explicit limiter key in the opts arg.
    const callOpts = createWorker.mock.calls[0]?.[3] as Record<string, unknown>
    expect(callOpts).not.toHaveProperty('limiter')
  })

  it('seeds correlation context with request_id from job data', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    let capturedWrappedProcessor:
      | ((job: unknown, token: unknown) => Promise<unknown>)
      | undefined
    const createWorker = vi.fn(
      (
        _queue: string,
        wrapped: (job: unknown, token: unknown) => Promise<unknown>,
      ) => {
        capturedWrappedProcessor = wrapped
        return workerStub
      },
    )
    let seenCorrelation: ReturnType<typeof getCorrelation>
    const processor = vi.fn(() => {
      seenCorrelation = getCorrelation()
      return Promise.resolve({ ok: true })
    })

    await createWorkerApp({
      name: 'embedding',
      queueName: 'embedding',
      models: ['m1'],
      processor,
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: vi.fn() as never,
      registerSigterm: false,
    })

    expect(capturedWrappedProcessor).toBeDefined()
    await capturedWrappedProcessor?.(
      {
        id: 'job-1',
        attemptsMade: 0,
        data: { request_id: 'r-fixture', userId: 'u1' },
      },
      'tok',
    )
    expect(processor).toHaveBeenCalledOnce()
    expect(seenCorrelation?.requestId).toBe('r-fixture')
    expect(seenCorrelation?.traceId).toHaveLength(32)
    expect(seenCorrelation?.spanId).toHaveLength(16)
    expect(seenCorrelation?.userId).toBe('u1')
  })

  it('omits userId from the frame when job data lacks it and still processes', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    let capturedWrappedProcessor:
      | ((job: unknown, token: unknown) => Promise<unknown>)
      | undefined
    const createWorker = vi.fn(
      (
        _queue: string,
        wrapped: (job: unknown, token: unknown) => Promise<unknown>,
      ) => {
        capturedWrappedProcessor = wrapped
        return workerStub
      },
    )
    let seenCorrelation: ReturnType<typeof getCorrelation>
    const processor = vi.fn(() => {
      seenCorrelation = getCorrelation()
      return Promise.resolve({ ok: true })
    })

    await createWorkerApp({
      name: 'embedding',
      queueName: 'embedding',
      models: ['m1'],
      processor,
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: vi.fn() as never,
      registerSigterm: false,
    })

    await capturedWrappedProcessor?.(
      { id: 'job-4', attemptsMade: 0, data: { request_id: 'r-no-user' } },
      'tok',
    )
    expect(processor).toHaveBeenCalledOnce()
    expect(seenCorrelation?.requestId).toBe('r-no-user')
    expect(seenCorrelation).not.toHaveProperty('userId')
  })

  it('mints a worker-prefixed request_id when job data omits it', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    let capturedWrappedProcessor:
      | ((job: unknown, token: unknown) => Promise<unknown>)
      | undefined
    const createWorker = vi.fn(
      (
        _queue: string,
        wrapped: (job: unknown, token: unknown) => Promise<unknown>,
      ) => {
        capturedWrappedProcessor = wrapped
        return workerStub
      },
    )
    let seenCorrelation: ReturnType<typeof getCorrelation>
    const processor = vi.fn(() => {
      seenCorrelation = getCorrelation()
      return Promise.resolve({ ok: true })
    })

    await createWorkerApp({
      name: 'embedding',
      queueName: 'embedding',
      models: ['m1'],
      processor,
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: vi.fn() as never,
      registerSigterm: false,
    })

    await capturedWrappedProcessor?.(
      { id: 'job-2', attemptsMade: 0, data: { userId: 'u1' } },
      'tok',
    )
    expect(seenCorrelation?.requestId).toMatch(/^worker-[0-9a-f]{8}$/)
  })

  it('skips correlation seeding when flagCheck returns false', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    let capturedWrappedProcessor:
      | ((job: unknown, token: unknown) => Promise<unknown>)
      | undefined
    const createWorker = vi.fn(
      (
        _queue: string,
        wrapped: (job: unknown, token: unknown) => Promise<unknown>,
      ) => {
        capturedWrappedProcessor = wrapped
        return workerStub
      },
    )
    let seenCorrelation: ReturnType<typeof getCorrelation>
    const processor = vi.fn(() => {
      seenCorrelation = getCorrelation()
      return Promise.resolve({ ok: true })
    })

    await createWorkerApp({
      name: 'embedding',
      queueName: 'embedding',
      models: ['m1'],
      processor,
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => ({}) as never,
      exit: vi.fn() as never,
      registerSigterm: false,
      flagCheck: () => false,
    })

    await capturedWrappedProcessor?.(
      {
        id: 'job-3',
        attemptsMade: 0,
        data: { request_id: 'r-fixture', userId: 'u1' },
      },
      'tok',
    )
    expect(processor).toHaveBeenCalledOnce()
    expect(seenCorrelation).toBeUndefined()
  })

  it('derives a deterministic 32-hex trace id from any request id', () => {
    const a = deriveTraceIdFromRequestId('my-client-trace-7')
    const b = deriveTraceIdFromRequestId('my-client-trace-7')
    const c = deriveTraceIdFromRequestId('my-client-trace-8')
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(c).toMatch(/^[0-9a-f]{32}$/)
  })

  it('SIGTERM handler survives Redis quit failure and still exits', async () => {
    const triton = makeTritonStub()
    const workerStub = makeWorkerStub()
    const createWorker = vi.fn().mockReturnValue(workerStub)
    const connection = {
      quit: vi.fn().mockRejectedValue(new Error('connection gone')),
    }
    const exit = vi.fn()

    await createWorkerApp({
      name: 'x',
      queueName: 'embedding',
      models: ['m1'],
      processor: vi.fn(),
      triton: triton as never,
      createWorker: createWorker as never,
      createConnection: () => connection as never,
      exit: exit as never,
    })

    const sigtermListeners = process.listeners('SIGTERM')
    const handler = sigtermListeners[sigtermListeners.length - 1]
    handler?.('SIGTERM')
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0)
    })
    expect(triton.close).toHaveBeenCalledOnce()
  })
})
