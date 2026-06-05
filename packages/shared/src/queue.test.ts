import { Worker } from 'bullmq'
import { describe, it, expect, vi } from 'vitest'

import { DEFAULT_JOB_OPTIONS, WORKER_DEFAULTS, createWorker } from './queue.ts'

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>()
  return {
    ...actual,
    Worker: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      close: vi.fn(),
    })),
  }
})

describe('DEFAULT_JOB_OPTIONS', () => {
  it('removeOnComplete equals { count: 1000 }', () => {
    expect(DEFAULT_JOB_OPTIONS?.removeOnComplete).toEqual({ count: 1000 })
  })

  it('removeOnFail equals { count: 100 }', () => {
    expect(DEFAULT_JOB_OPTIONS?.removeOnFail).toEqual({ count: 100 })
  })

  it('attempts equals 5', () => {
    expect(DEFAULT_JOB_OPTIONS?.attempts).toEqual(5)
  })

  it('backoff equals { type: "exponential", delay: 30_000 }', () => {
    expect(DEFAULT_JOB_OPTIONS?.backoff).toEqual({
      type: 'exponential',
      delay: 30_000,
    })
  })
})

describe('WORKER_DEFAULTS', () => {
  it('concurrency equals 4', () => {
    expect(WORKER_DEFAULTS.concurrency).toEqual(4)
  })

  it('lockDuration equals 300000', () => {
    expect(WORKER_DEFAULTS.lockDuration).toEqual(300_000)
  })

  it('lockRenewTime is well below lockDuration / 2', () => {
    const lockDuration = WORKER_DEFAULTS.lockDuration ?? 0
    const lockRenewTime = WORKER_DEFAULTS.lockRenewTime ?? Infinity
    expect(lockRenewTime).toBeLessThan(lockDuration / 2)
  })

  it('maxStalledCount equals 2', () => {
    expect(WORKER_DEFAULTS.maxStalledCount).toEqual(2)
  })
})

describe('createWorker', () => {
  it('passes limiter and merges WORKER_DEFAULTS to BullMQ Worker constructor', () => {
    const mockConnection = {} as Parameters<typeof createWorker>[2]
    const mockProcessor = async () => {}

    createWorker('test-queue', mockProcessor, mockConnection, {
      limiter: { max: 20, duration: 1000 },
    })

    expect(Worker).toHaveBeenCalledWith(
      'test-queue',
      mockProcessor,
      expect.objectContaining({
        limiter: { max: 20, duration: 1000 },
        concurrency: 4,
      }),
    )
  })
})
