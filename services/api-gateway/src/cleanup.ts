import { randomUUID } from 'node:crypto'

import type { Queue } from '@protifer/shared'

import type { JobCleanupMetrics, ReconcileReason } from './metrics.ts'
import type { RedisCommands } from './queue.ts'

export const ACTIVE_JOBS_KEY = (userId: string) => `active-jobs:${userId}`
export const JOB_USER_MAP_KEY = 'job-user-map'
export const ACTIVE_JOBS_TTL_SECONDS = 86400
export const JOB_USER_MAP_TTL_SECONDS = 172800
export const RECONCILE_LOCK_KEY = 'job-cleanup:reconcile-lock'

export const DEFAULT_RECONCILE_INTERVAL_MS = 60_000
export const DEFAULT_RECONCILE_LOCK_TTL_MS = 30_000

export interface SweepResult {
  sweptKeys: number
  removedEntries: number
  removedByReason: Record<ReconcileReason, number>
  durationMs: number
}

interface CleanupLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Minimal QueueEvents surface cleanup needs. Instances are created and
 * closed by the app (shared with pipeline metrics) — cleanup only listens.
 */
export interface CleanupQueueEvents {
  on: (
    event: 'completed' | 'failed',
    listener: (args: { jobId: string }) => void,
  ) => unknown
}

interface CleanupDeps {
  redis: RedisCommands
  logger: CleanupLogger
  predictionEvents: CleanupQueueEvents
  embeddingEvents: CleanupQueueEvents
  predictionQueue: Queue
  embeddingQueue: Queue
  metrics?: JobCleanupMetrics
  /** Observe-only stale waiting-children scan, run on the leader sweep. */
  staleChildrenScan?: () => Promise<void>
  intervalMs?: number
  lockTtlMs?: number
  instanceId?: string
  clock?: { now: () => number }
}

export interface CleanupHandle {
  close: () => Promise<void>
  reconcileNow: () => Promise<SweepResult>
}

export async function trackJob(
  redis: RedisCommands,
  userId: string,
  jobId: string,
): Promise<void> {
  await redis.hset(JOB_USER_MAP_KEY, jobId, userId)
  await redis.expire(JOB_USER_MAP_KEY, JOB_USER_MAP_TTL_SECONDS)
  await redis.expire(ACTIVE_JOBS_KEY(userId), ACTIVE_JOBS_TTL_SECONDS)
}

interface LockCommands {
  set: (
    key: string,
    value: string,
    mode: 'PX',
    ttl: number,
    flag: 'NX',
  ) => Promise<string | null>
  eval: (
    script: string,
    numKeys: number,
    ...args: string[]
  ) => Promise<number | null>
}

export async function acquireLeaderLock(
  redis: RedisCommands,
  key: string,
  instanceId: string,
  ttlMs: number,
): Promise<boolean> {
  const lockRedis = redis as unknown as LockCommands
  const result = await lockRedis.set(key, instanceId, 'PX', ttlMs, 'NX')
  return result === 'OK'
}

const RELEASE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`

export async function releaseLeaderLockIfOwner(
  redis: RedisCommands,
  key: string,
  instanceId: string,
): Promise<void> {
  const lockRedis = redis as unknown as LockCommands
  await lockRedis.eval(RELEASE_SCRIPT, 1, key, instanceId)
}

interface SweepDeps {
  redis: RedisCommands
  logger: CleanupLogger
  predictionQueue: Queue
  embeddingQueue: Queue
  metrics?: JobCleanupMetrics
  clock?: { now: () => number }
}

export async function runReconcileSweep(deps: SweepDeps): Promise<SweepResult> {
  const { redis, logger, predictionQueue, embeddingQueue, metrics } = deps
  const now = deps.clock?.now ?? Date.now
  const startMs = now()
  const removedByReason: Record<ReconcileReason, number> = {
    completed: 0,
    failed: 0,
    'no-job': 0,
  }
  let sweptKeys = 0
  let removedEntries = 0

  let cursor = '0'
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      'active-jobs:*',
      'COUNT',
      '100',
    )
    cursor = nextCursor
    for (const key of keys) {
      sweptKeys += 1
      const members = await redis.zrangebyscore(key, '-inf', '+inf')
      for (const jobId of members) {
        const job =
          (await predictionQueue.getJob(jobId)) ??
          (await embeddingQueue.getJob(jobId))
        const state = job ? await job.getState() : null
        let reason: ReconcileReason | null = null
        if (!job) {
          reason = 'no-job'
        } else if (state === 'completed') {
          reason = 'completed'
        } else if (state === 'failed') {
          reason = 'failed'
        }
        if (!reason) continue

        const userId = await redis.hget(JOB_USER_MAP_KEY, jobId)
        await redis.zrem(key, jobId)
        await redis.hdel(JOB_USER_MAP_KEY, jobId)
        removedByReason[reason] += 1
        removedEntries += 1
        metrics?.reconciled.inc({ reason }, 1)
        logger.warn(
          { userId: userId ?? null, jobId, reason, key },
          'reconcile: removed stale active-jobs entry',
        )
      }
      const remaining = await redis.zcard(key)
      if (remaining > 0) {
        await redis.expire(key, ACTIVE_JOBS_TTL_SECONDS)
      }
    }
  } while (cursor !== '0')

  const durationMs = now() - startMs
  metrics?.sweepDuration.observe(durationMs / 1000)
  return { sweptKeys, removedEntries, removedByReason, durationMs }
}

export function setupJobCleanup(deps: CleanupDeps): CleanupHandle {
  const {
    redis,
    logger,
    predictionEvents,
    embeddingEvents,
    predictionQueue,
    embeddingQueue,
    metrics,
  } = deps
  const intervalMs = deps.intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS
  const lockTtlMs = deps.lockTtlMs ?? DEFAULT_RECONCILE_LOCK_TTL_MS
  const instanceId = deps.instanceId ?? randomUUID()

  async function handleCleanup(jobId: string) {
    try {
      const userId = await redis.hget(JOB_USER_MAP_KEY, jobId)
      if (!userId) {
        logger.warn({ jobId }, 'cleanup: no userId in job-user-map')
        return
      }
      const key = ACTIVE_JOBS_KEY(userId)
      await redis.zrem(key, jobId)
      await redis.hdel(JOB_USER_MAP_KEY, jobId)
      const remaining = await redis.zcard(key)
      if (remaining > 0) {
        await redis.expire(key, ACTIVE_JOBS_TTL_SECONDS)
      }
    } catch (err) {
      logger.error({ err, jobId }, 'cleanup: error during job cleanup')
    }
  }

  for (const events of [predictionEvents, embeddingEvents]) {
    events.on('completed', ({ jobId }) => {
      void handleCleanup(jobId)
    })
    events.on('failed', ({ jobId }) => {
      void handleCleanup(jobId)
    })
  }

  const sweepDeps: SweepDeps = {
    redis,
    logger,
    predictionQueue,
    embeddingQueue,
    metrics,
    clock: deps.clock,
  }

  // Only awaited for sequencing (never its resolved value), so the element
  // type is irrelevant — `unknown` lets both code paths assign their promise
  // directly without fabricating placeholder results.
  let inFlight: Promise<unknown> | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let closed = false
  let heldLock = false

  async function runSweepAsLeader(): Promise<void> {
    let acquired = false
    try {
      acquired = await acquireLeaderLock(
        redis,
        RECONCILE_LOCK_KEY,
        instanceId,
        lockTtlMs,
      )
    } catch (err) {
      logger.error({ err }, 'reconcile: lock acquire failed')
      metrics?.sweeps.inc({ outcome: 'error' }, 1)
      return
    }
    if (!acquired) {
      metrics?.sweeps.inc({ outcome: 'skipped-not-leader' }, 1)
      return
    }
    heldLock = true
    try {
      await runReconcileSweep(sweepDeps)
      metrics?.sweeps.inc({ outcome: 'ran' }, 1)
      if (deps.staleChildrenScan) {
        try {
          await deps.staleChildrenScan()
        } catch (err) {
          logger.warn({ err }, 'reconcile: stale-children scan failed')
        }
      }
    } catch (err) {
      logger.error({ err }, 'reconcile: sweep failed')
      metrics?.sweeps.inc({ outcome: 'error' }, 1)
    } finally {
      try {
        await releaseLeaderLockIfOwner(redis, RECONCILE_LOCK_KEY, instanceId)
      } catch (err) {
        logger.warn({ err }, 'reconcile: lock release failed')
      }
      heldLock = false
    }
  }

  function startPeriodic() {
    if (intervalMs <= 0 || closed) return
    timer = setInterval(() => {
      if (inFlight) {
        metrics?.sweeps.inc({ outcome: 'skipped-not-leader' }, 1)
        return
      }
      const p = runSweepAsLeader().catch((err: unknown) => {
        logger.error({ err }, 'reconcile: periodic tick error')
      })
      inFlight = p
      void p.finally(() => {
        inFlight = null
      })
    }, intervalMs)
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }
  }

  async function reconcileNow(): Promise<SweepResult> {
    if (inFlight) {
      await inFlight.catch(() => undefined)
    }
    const p = runReconcileSweep(sweepDeps)
    inFlight = p
    try {
      const result = await p
      metrics?.sweeps.inc({ outcome: 'ran' }, 1)
      return result
    } catch (err) {
      metrics?.sweeps.inc({ outcome: 'error' }, 1)
      throw err
    } finally {
      inFlight = null
    }
  }

  startPeriodic()

  // Initial sweep 5s after boot so reconciliation begins before the first
  // periodic tick lands.
  if (intervalMs > 0) {
    const bootKick = setTimeout(() => {
      if (closed) return
      void runSweepAsLeader().catch((err: unknown) => {
        logger.error({ err }, 'reconcile: startup sweep failed')
      })
    }, 5000)
    if (typeof (bootKick as { unref?: () => void }).unref === 'function') {
      ;(bootKick as { unref: () => void }).unref()
    }
  }

  return {
    close: async () => {
      closed = true
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (inFlight) {
        await inFlight.catch(() => undefined)
      }
      if (heldLock) {
        try {
          await releaseLeaderLockIfOwner(redis, RECONCILE_LOCK_KEY, instanceId)
        } catch (err) {
          logger.warn({ err }, 'reconcile: lock release on close failed')
        }
      }
    },
    reconcileNow,
  }
}
