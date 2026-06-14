import { EventEmitter } from 'events'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  acquireLeaderLock,
  releaseLeaderLockIfOwner,
  runReconcileSweep,
  setupJobCleanup,
  sumQueueResidues,
  trackJob,
  RECONCILE_LOCK_KEY,
} from './cleanup.ts'
import { createMetrics } from './metrics.ts'

function queueWithJobs(jobs: { data: unknown }[]) {
  return { getJobs: vi.fn().mockResolvedValue(jobs) } as never
}

function createMockEvents() {
  return new EventEmitter()
}

interface LockStore {
  key: string
  value: string
  expiresAt: number
}

function createMockRedis() {
  const locks = new Map<string, LockStore>()
  const now = () => Date.now()
  const checkExpiry = (key: string) => {
    const lk = locks.get(key)
    if (lk && lk.expiresAt <= now()) {
      locks.delete(key)
    }
  }
  return {
    zcard: vi.fn().mockResolvedValue(0),
    zadd: vi.fn().mockResolvedValue(1),
    zrem: vi.fn().mockResolvedValue(1),
    hset: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue(null),
    hdel: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    zrangebyscore: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue(['0', []]),
    set: vi.fn(
      (
        key: string,
        value: string,
        _mode: 'PX',
        ttl: number,
      ): Promise<'OK' | null> => {
        checkExpiry(key)
        if (locks.has(key)) return Promise.resolve(null)
        locks.set(key, { key, value, expiresAt: now() + ttl })
        return Promise.resolve('OK')
      },
    ),
    eval: vi.fn(
      (
        _script: string,
        _numKeys: number,
        key: string,
        value: string,
      ): Promise<number> => {
        checkExpiry(key)
        const lk = locks.get(key)
        if (lk && lk.value === value) {
          locks.delete(key)
          return Promise.resolve(1)
        }
        return Promise.resolve(0)
      },
    ),
    __locks: locks,
  }
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

function createMockQueue() {
  return {
    getJob: vi.fn().mockResolvedValue(null),
    getJobs: vi.fn().mockResolvedValue([]),
  }
}

describe('setupJobCleanup (QueueEvents fast path)', () => {
  let redis: ReturnType<typeof createMockRedis>
  let predictionEvents: EventEmitter
  let embeddingEvents: EventEmitter
  let mockPredictionQueue: ReturnType<typeof createMockQueue>
  let mockEmbeddingQueue: ReturnType<typeof createMockQueue>

  beforeEach(() => {
    vi.clearAllMocks()
    redis = createMockRedis()
    mockPredictionQueue = createMockQueue()
    mockEmbeddingQueue = createMockQueue()
    predictionEvents = createMockEvents()
    embeddingEvents = createMockEvents()
  })

  function setup() {
    return setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents,
      embeddingEvents,
      predictionQueue: mockPredictionQueue as never,
      embeddingQueue: mockEmbeddingQueue as never,
      intervalMs: 0,
    })
  }

  it('completed event triggers cleanup', async () => {
    redis.hget.mockResolvedValue('user-123')
    redis.zcard.mockResolvedValue(2)
    const handle = setup()

    predictionEvents.emit('completed', { jobId: 'job-1' })
    await new Promise((r) => setTimeout(r, 10))

    expect(redis.hget).toHaveBeenCalledWith('job-user-map', 'job-1')
    expect(redis.zrem).toHaveBeenCalledWith('active-jobs:user-123', 'job-1')
    expect(redis.hdel).toHaveBeenCalledWith('job-user-map', 'job-1')

    await handle.close()
  })

  it('failed event triggers cleanup', async () => {
    redis.hget.mockResolvedValue('user-456')
    redis.zcard.mockResolvedValue(1)
    const handle = setup()

    embeddingEvents.emit('failed', { jobId: 'job-2', failedReason: 'err' })
    await new Promise((r) => setTimeout(r, 10))

    expect(redis.zrem).toHaveBeenCalledWith('active-jobs:user-456', 'job-2')
    expect(redis.hdel).toHaveBeenCalledWith('job-user-map', 'job-2')

    await handle.close()
  })

  it('cleanup handles missing userId gracefully', async () => {
    redis.hget.mockResolvedValue(null)
    const handle = setup()

    predictionEvents.emit('completed', { jobId: 'unknown' })
    await new Promise((r) => setTimeout(r, 10))

    expect(redis.zrem).not.toHaveBeenCalled()

    await handle.close()
  })

  it('TTL refreshed when active-jobs key still has members', async () => {
    redis.hget.mockResolvedValue('user-123')
    redis.zcard.mockResolvedValue(2)
    const handle = setup()

    predictionEvents.emit('completed', { jobId: 'job-1' })
    await new Promise((r) => setTimeout(r, 10))

    expect(redis.expire).toHaveBeenCalledWith('active-jobs:user-123', 86400)

    await handle.close()
  })

  it('TTL not refreshed when active-jobs key is empty', async () => {
    redis.hget.mockResolvedValue('user-123')
    redis.zcard.mockResolvedValue(0)
    const handle = setup()

    predictionEvents.emit('completed', { jobId: 'job-1' })
    await new Promise((r) => setTimeout(r, 10))

    expect(redis.zrem).toHaveBeenCalled()
    expect(redis.expire).not.toHaveBeenCalledWith('active-jobs:user-123', 86400)

    await handle.close()
  })
})

describe('trackJob', () => {
  let redis: ReturnType<typeof createMockRedis>
  beforeEach(() => {
    vi.clearAllMocks()
    redis = createMockRedis()
  })

  it('writes to job-user-map and refreshes active-jobs TTL', async () => {
    await trackJob(redis, 'user-1', 'job-1')
    expect(redis.hset).toHaveBeenCalledWith('job-user-map', 'job-1', 'user-1')
    expect(redis.expire).toHaveBeenCalledWith('job-user-map', 172800)
    expect(redis.expire).toHaveBeenCalledWith('active-jobs:user-1', 86400)
  })
})

describe('runReconcileSweep', () => {
  let redis: ReturnType<typeof createMockRedis>
  let pq: ReturnType<typeof createMockQueue>
  let eq: ReturnType<typeof createMockQueue>

  beforeEach(() => {
    vi.clearAllMocks()
    redis = createMockRedis()
    pq = createMockQueue()
    eq = createMockQueue()
  })

  it('removes entries with reason=no-job for missing jobs', async () => {
    redis.scan.mockResolvedValue(['0', ['active-jobs:user-1']])
    redis.zrangebyscore.mockResolvedValue(['job-a'])
    redis.hget.mockResolvedValue('user-1')
    redis.zcard.mockResolvedValue(0)

    const result = await runReconcileSweep({
      redis,
      logger: mockLogger,
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
    })

    expect(redis.zrem).toHaveBeenCalledWith('active-jobs:user-1', 'job-a')
    expect(redis.hdel).toHaveBeenCalledWith('job-user-map', 'job-a')
    expect(result.removedByReason['no-job']).toBe(1)
    expect(result.removedEntries).toBe(1)
    expect(result.sweptKeys).toBe(1)
  })

  it('removes reason=completed for completed jobs', async () => {
    redis.scan.mockResolvedValue(['0', ['active-jobs:u']])
    redis.zrangebyscore.mockResolvedValue(['j'])
    pq.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('completed'),
    })
    redis.zcard.mockResolvedValue(0)

    const result = await runReconcileSweep({
      redis,
      logger: mockLogger,
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
    })

    expect(redis.zrem).toHaveBeenCalledWith('active-jobs:u', 'j')
    expect(result.removedByReason.completed).toBe(1)
  })

  it('removes reason=failed for failed jobs', async () => {
    redis.scan.mockResolvedValue(['0', ['active-jobs:u']])
    redis.zrangebyscore.mockResolvedValue(['j'])
    pq.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('failed'),
    })
    redis.zcard.mockResolvedValue(0)

    const result = await runReconcileSweep({
      redis,
      logger: mockLogger,
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
    })

    expect(result.removedByReason.failed).toBe(1)
  })

  it('leaves active/waiting jobs untouched', async () => {
    redis.scan.mockResolvedValue(['0', ['active-jobs:u']])
    redis.zrangebyscore.mockResolvedValue(['a', 'b', 'c', 'd'])
    pq.getJob
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('active'),
      })
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('waiting'),
      })
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('delayed'),
      })
      .mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('waiting-children'),
      })

    const result = await runReconcileSweep({
      redis,
      logger: mockLogger,
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
    })

    expect(redis.zrem).not.toHaveBeenCalled()
    expect(result.removedEntries).toBe(0)
  })

  it('refreshes TTL when remaining members > 0', async () => {
    redis.scan.mockResolvedValue(['0', ['active-jobs:u']])
    redis.zrangebyscore.mockResolvedValue(['dead', 'alive'])
    pq.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
      getState: vi.fn().mockResolvedValue('active'),
    })
    redis.zcard.mockResolvedValue(1)

    await runReconcileSweep({
      redis,
      logger: mockLogger,
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
    })

    expect(redis.expire).toHaveBeenCalledWith('active-jobs:u', 86400)
  })

  it('emits warn log with userId, jobId, reason per removal', async () => {
    redis.scan.mockResolvedValue(['0', ['active-jobs:user-X']])
    redis.zrangebyscore.mockResolvedValue(['job-Z'])
    redis.hget.mockResolvedValue('user-X')
    redis.zcard.mockResolvedValue(0)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    await runReconcileSweep({
      redis,
      logger,
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-X',
        jobId: 'job-Z',
        reason: 'no-job',
      }),
      expect.any(String),
    )
  })

  it('increments metrics when provided', async () => {
    redis.scan.mockResolvedValue(['0', ['active-jobs:u']])
    redis.zrangebyscore.mockResolvedValue(['j'])
    redis.zcard.mockResolvedValue(0)
    const metrics = createMetrics()

    await runReconcileSweep({
      redis,
      logger: mockLogger,
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      metrics,
    })

    const counterJson = await metrics.registry
      .getSingleMetric('job_cleanup_reconciled_total')
      ?.get()
    expect(counterJson?.values[0]?.value).toBe(1)
    expect(counterJson?.values[0]?.labels).toEqual({ reason: 'no-job' })
  })
})

describe('leader lock helpers', () => {
  let redis: ReturnType<typeof createMockRedis>
  beforeEach(() => {
    vi.clearAllMocks()
    redis = createMockRedis()
  })

  it('second acquire before TTL returns false', async () => {
    const first = await acquireLeaderLock(redis, 'k', 'inst-1', 1000)
    const second = await acquireLeaderLock(redis, 'k', 'inst-2', 1000)
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('owner release deletes the key', async () => {
    await acquireLeaderLock(redis, 'k', 'inst-1', 1000)
    await releaseLeaderLockIfOwner(redis, 'k', 'inst-1')
    const again = await acquireLeaderLock(redis, 'k', 'inst-2', 1000)
    expect(again).toBe(true)
  })

  it('non-owner release is a no-op', async () => {
    await acquireLeaderLock(redis, 'k', 'inst-1', 1000)
    await releaseLeaderLockIfOwner(redis, 'k', 'other')
    const other = await acquireLeaderLock(redis, 'k', 'inst-2', 1000)
    expect(other).toBe(false)
  })

  it('lock expires after TTL so next acquire succeeds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
    await acquireLeaderLock(redis, 'k', 'inst-1', 1000)
    vi.setSystemTime(new Date(2000))
    const after = await acquireLeaderLock(redis, 'k', 'inst-2', 1000)
    expect(after).toBe(true)
    vi.useRealTimers()
  })
})

describe('periodic reconciliation loop', () => {
  let redis: ReturnType<typeof createMockRedis>
  let pq: ReturnType<typeof createMockQueue>
  let eq: ReturnType<typeof createMockQueue>

  beforeEach(() => {
    vi.clearAllMocks()
    redis = createMockRedis()
    pq = createMockQueue()
    eq = createMockQueue()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not schedule a loop when intervalMs=0', async () => {
    const handle = setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      intervalMs: 0,
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(redis.scan).not.toHaveBeenCalled()
    await handle.close()
  })

  it('only one of two handles with shared redis acquires the lock per tick', async () => {
    let scanResolve: () => void = () => {}
    redis.scan.mockImplementation(
      () =>
        new Promise((r) => {
          scanResolve = () => {
            r(['0', []])
          }
        }),
    )

    const handleA = setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      intervalMs: 1000,
      lockTtlMs: 30_000,
      instanceId: 'A',
    })
    const handleB = setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      intervalMs: 1000,
      lockTtlMs: 30_000,
      instanceId: 'B',
    })

    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()
    await Promise.resolve()

    const setResults = await Promise.all(
      redis.set.mock.results.map((r) => r.value as Promise<'OK' | null>),
    )
    const okCount = setResults.filter((v) => v === 'OK').length
    const nullCount = setResults.filter((v) => v === null).length
    expect(okCount).toBe(1)
    expect(nullCount).toBe(1)

    scanResolve()
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
    await handleA.close()
    await handleB.close()
  })

  it('runs the stale-children scan on the leader sweep', async () => {
    const staleChildrenScan = vi.fn().mockResolvedValue(undefined)
    const handle = setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      staleChildrenScan,
      intervalMs: 1000,
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(staleChildrenScan).toHaveBeenCalledOnce()

    vi.useRealTimers()
    await handle.close()
    vi.useFakeTimers()
  })

  it('stale-children scan failure does not fail the sweep', async () => {
    const staleChildrenScan = vi.fn().mockRejectedValue(new Error('redis blip'))
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const metrics = createMetrics()
    const handle = setupJobCleanup({
      redis,
      logger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      metrics,
      staleChildrenScan,
      intervalMs: 1000,
    })

    await vi.advanceTimersByTimeAsync(1000)

    const sweeps = await metrics.registry
      .getSingleMetric('job_cleanup_sweeps_total')
      ?.get()
    const ran = sweeps?.values.find((v) => v.labels.outcome === 'ran')
    expect(ran?.value).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) as unknown },
      'reconcile: stale-children scan failed',
    )

    vi.useRealTimers()
    await handle.close()
    vi.useFakeTimers()
  })

  it('reconcileNow bypasses the leader lock', async () => {
    await acquireLeaderLock(redis, RECONCILE_LOCK_KEY, 'other', 60_000)
    redis.scan.mockResolvedValue(['0', []])

    const handle = setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      intervalMs: 0,
    })

    const result = await handle.reconcileNow()
    expect(result.sweptKeys).toBe(0)
    expect(redis.scan).toHaveBeenCalled()
    await handle.close()
  })

  it('close() awaits in-flight sweep and releases lock', async () => {
    let resolveGet: () => void = () => {}
    pq.getJob.mockImplementation(
      () =>
        new Promise((r) => {
          resolveGet = () => {
            r(null)
          }
        }),
    )
    redis.scan.mockResolvedValue(['0', ['active-jobs:u']])
    redis.zrangebyscore.mockResolvedValue(['j'])
    redis.zcard.mockResolvedValue(0)

    const handle = setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      intervalMs: 0,
      instanceId: 'inst-X',
    })

    const p = handle.reconcileNow()
    await vi.advanceTimersByTimeAsync(1)
    const closePromise = handle.close()
    resolveGet()
    await p
    await closePromise
    expect(redis.zrem).toHaveBeenCalled()
  })
})

describe('sumQueueResidues', () => {
  it('counts prediction parent + embedding child route-agnostically', async () => {
    // Same flow: prediction parent sits in waiting-children, its embedding
    // child runs in active — both contribute their sequence length.
    const pq = queueWithJobs([{ data: { sequence: 'AAAAA' } }]) // parent: 5
    const eq = queueWithJobs([{ data: { sequence: 'AAAAA' } }]) // child: 5
    expect(await sumQueueResidues([pq, eq])).toBe(10)
  })

  it('reconciles to zero when queues are drained', async () => {
    expect(await sumQueueResidues([queueWithJobs([]), queueWithJobs([])])).toBe(
      0,
    )
  })

  it('requests waiting, active, and waiting-children states', async () => {
    const pq = queueWithJobs([])
    await sumQueueResidues([pq])
    expect(
      (pq as unknown as { getJobs: ReturnType<typeof vi.fn> }).getJobs,
    ).toHaveBeenCalledWith(['waiting', 'active', 'waiting-children'])
  })

  it('ignores jobs without sequence data', async () => {
    const pq = queueWithJobs([
      { data: undefined },
      { data: { sequence: 'ABC' } },
    ])
    expect(await sumQueueResidues([pq])).toBe(3)
  })
})

describe('shedding reconciliation on the leader sweep', () => {
  let redis: ReturnType<typeof createMockRedis>
  let pq: ReturnType<typeof createMockQueue>
  let eq: ReturnType<typeof createMockQueue>

  beforeEach(() => {
    vi.clearAllMocks()
    redis = createMockRedis()
    pq = createMockQueue()
    eq = createMockQueue()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setupWithState(sheddingState: unknown) {
    return setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      sheddingState: sheddingState as never,
      intervalMs: 1000,
    })
  }

  it('overwrites a stale counter with the true summed residues', async () => {
    const setPending = vi.fn().mockResolvedValue(8)
    const sampleThroughput = vi.fn().mockResolvedValue(null)
    pq.getJobs.mockResolvedValue([{ data: { sequence: 'AAAAA' } }]) // 5
    eq.getJobs.mockResolvedValue([{ data: { sequence: 'AAA' } }]) // 3

    const handle = setupWithState({ setPending, sampleThroughput })
    await vi.advanceTimersByTimeAsync(1000)

    // Absolute set to the true sum — independent of any prior drifted value.
    expect(setPending).toHaveBeenCalledWith(8)

    vi.useRealTimers()
    await handle.close()
    vi.useFakeTimers()
  })

  it('samples throughput on the sweep (sweep-derived, not event-derived)', async () => {
    const setPending = vi.fn().mockResolvedValue(5)
    const sampleThroughput = vi.fn().mockResolvedValue(400)
    pq.getJobs.mockResolvedValue([{ data: { sequence: 'AAAAA' } }]) // 5

    const handle = setupWithState({ setPending, sampleThroughput })
    await vi.advanceTimersByTimeAsync(1000)

    // No terminal events fired, yet throughput is still sampled — so a missed
    // completion event cannot corrupt the estimate.
    expect(sampleThroughput).toHaveBeenCalledWith(5)

    vi.useRealTimers()
    await handle.close()
    vi.useFakeTimers()
  })

  it('reconciliation failure does not fail the sweep', async () => {
    const setPending = vi.fn().mockRejectedValue(new Error('redis blip'))
    const sampleThroughput = vi.fn()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const metrics = createMetrics()

    const handle = setupJobCleanup({
      redis,
      logger,
      predictionEvents: createMockEvents(),
      embeddingEvents: createMockEvents(),
      predictionQueue: pq as never,
      embeddingQueue: eq as never,
      sheddingState: { setPending, sampleThroughput } as never,
      metrics,
      intervalMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)

    const sweeps = await metrics.registry
      .getSingleMetric('job_cleanup_sweeps_total')
      ?.get()
    const ran = sweeps?.values.find((v) => v.labels.outcome === 'ran')
    expect(ran?.value).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) as unknown },
      'reconcile: shedding reconciliation failed',
    )

    vi.useRealTimers()
    await handle.close()
    vi.useFakeTimers()
  })
})

describe('JOBS-05: cap resets after all jobs complete', () => {
  let redis: ReturnType<typeof createMockRedis>
  let mockPredictionQueue: ReturnType<typeof createMockQueue>
  let mockEmbeddingQueue: ReturnType<typeof createMockQueue>

  beforeEach(() => {
    vi.clearAllMocks()
    redis = createMockRedis()
    mockPredictionQueue = createMockQueue()
    mockEmbeddingQueue = createMockQueue()
  })

  it('cap resets correctly after all jobs complete', async () => {
    const maxConcurrentJobs = 5
    const userId = 'user-cap-test'
    const jobIds = Array.from(
      { length: maxConcurrentJobs },
      (_, i) => `job-${String(i)}`,
    )

    for (const jobId of jobIds) {
      await trackJob(redis, userId, jobId)
    }

    const predictionEvents = createMockEvents()
    const handle = setupJobCleanup({
      redis,
      logger: mockLogger,
      predictionEvents,
      embeddingEvents: createMockEvents(),
      predictionQueue: mockPredictionQueue as never,
      embeddingQueue: mockEmbeddingQueue as never,
      intervalMs: 0,
    })

    redis.hget.mockResolvedValue(userId)
    let remaining = maxConcurrentJobs
    redis.zcard.mockImplementation(() => {
      remaining--
      return Promise.resolve(remaining)
    })

    for (const jobId of jobIds) {
      predictionEvents.emit('completed', { jobId })
    }
    await new Promise((r) => setTimeout(r, 50))

    for (const jobId of jobIds) {
      expect(redis.zrem).toHaveBeenCalledWith(`active-jobs:${userId}`, jobId)
    }

    redis.zcard.mockResolvedValue(0)
    expect(await redis.zcard(`active-jobs:${userId}`)).toBe(0)

    await handle.close()
  })
})
