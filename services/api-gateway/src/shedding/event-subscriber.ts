import { randomUUID } from 'node:crypto'

import type {
  BullMQConnection,
  EmbeddingJobData,
  Queue,
  QueueEvents as QueueEventsType,
} from '@protifer/shared'
import { QUEUE_NAMES, QueueEvents } from '@protifer/shared'

import { acquireLeaderLock, releaseLeaderLockIfOwner } from '../cleanup.ts'
import type { RedisCommands } from '../queue.ts'
import type { SheddingState, SheddingRedis } from './state.ts'

export const ACCOUNTING_LOCK_KEY = 'shedding:accounting-lock'

export const DEFAULT_ACCOUNTING_LOCK_TTL_MS = 30_000
export const DEFAULT_ACCOUNTING_RENEW_INTERVAL_MS = 10_000

interface SubscriberLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Redis command surface needed for leader election. Uses a `set` signature
 * compatible with the cleanup module's `acquireLeaderLock` helper.
 */
export type LeaderRedis = RedisCommands & SheddingRedis

export interface EventSubscriberDeps {
  redis: LeaderRedis
  connection: BullMQConnection
  embeddingQueue: Queue
  state: SheddingState
  logger: SubscriberLogger
  lockTtlMs?: number
  renewIntervalMs?: number
  instanceId?: string
  /**
   * Factory for QueueEvents — test seam. Defaults to the real BullMQ
   * `QueueEvents` constructor.
   */
  queueEventsFactory?: (
    name: string,
    connection: BullMQConnection,
  ) => QueueEventsType
}

export interface EventSubscriberHandle {
  close: () => Promise<void>
  /** Test-only: current leadership state. */
  isLeader: () => boolean
}

export function startEventSubscriber(
  deps: EventSubscriberDeps,
): EventSubscriberHandle {
  const {
    redis,
    connection,
    embeddingQueue,
    state,
    logger,
    queueEventsFactory = (name, conn) =>
      new QueueEvents(name, { connection: conn }),
  } = deps
  const lockTtlMs = deps.lockTtlMs ?? DEFAULT_ACCOUNTING_LOCK_TTL_MS
  const renewIntervalMs =
    deps.renewIntervalMs ?? DEFAULT_ACCOUNTING_RENEW_INTERVAL_MS
  const instanceId = deps.instanceId ?? randomUUID()

  let closed = false
  let leader = false
  let events: QueueEventsType | null = null
  let renewTimer: ReturnType<typeof setInterval> | null = null

  // Fast-path decrement hint only. Throughput is now derived entirely from
  // the leader sweep's drain-rate sampler, so a missed terminal event here
  // self-heals at the next reconciliation instead of corrupting the estimate.
  async function handleTerminal(jobId: string): Promise<void> {
    if (!leader) return
    try {
      const job = await embeddingQueue.getJob(jobId)
      if (!job) return
      const data = job.data as EmbeddingJobData | undefined
      const residues = data?.sequence.length ?? 0
      if (residues <= 0) return

      await state.decrementPending(residues)
    } catch (err) {
      logger.warn({ err, jobId }, 'shedding: terminal event handler failed')
    }
  }

  function startSubscription() {
    if (events) return
    events = queueEventsFactory(QUEUE_NAMES.EMBEDDING, connection)
    events.on('error', (err: Error) => {
      logger.warn({ err }, 'shedding: QueueEvents error')
    })
    events.on('completed', ({ jobId }: { jobId: string }) => {
      void handleTerminal(jobId)
    })
    events.on('failed', ({ jobId }: { jobId: string }) => {
      void handleTerminal(jobId)
    })
  }

  async function stopSubscription(): Promise<void> {
    const e = events
    events = null
    if (e) {
      try {
        await e.close()
      } catch (err) {
        logger.warn({ err }, 'shedding: QueueEvents close failed')
      }
    }
  }

  async function renewLoop(): Promise<void> {
    if (closed) return
    try {
      // Use SET key value PX ttl XX (renew if owner) via eval. ioredis
      // `set` with mode PX + NX cannot renew, so we use a small Lua.
      const renewed = await (
        redis as unknown as {
          eval: (
            script: string,
            numKeys: number,
            ...args: string[]
          ) => Promise<number>
        }
      ).eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then
           return redis.call('PEXPIRE', KEYS[1], ARGV[2])
         else
           return 0
         end`,
        1,
        ACCOUNTING_LOCK_KEY,
        instanceId,
        String(lockTtlMs),
      )
      if (renewed === 1) {
        if (!leader) {
          leader = true
          startSubscription()
          logger.info({ instanceId }, 'shedding: became accounting leader')
        }
        return
      }
      // Not the owner — try to acquire.
      const acquired = await acquireLeaderLock(
        redis,
        ACCOUNTING_LOCK_KEY,
        instanceId,
        lockTtlMs,
      )
      if (acquired) {
        leader = true
        startSubscription()
        logger.info({ instanceId }, 'shedding: acquired accounting lock')
      } else if (leader) {
        leader = false
        await stopSubscription()
        logger.warn(
          { instanceId },
          'shedding: lost accounting lock — stopped subscriber',
        )
      }
    } catch (err) {
      logger.warn({ err }, 'shedding: leader renewal failed')
      if (leader) {
        leader = false
        await stopSubscription()
      }
    }
  }

  // Kick first election immediately, then renew on interval.
  void renewLoop().then(() => {
    if (closed) return
    renewTimer = setInterval(() => {
      void renewLoop()
    }, renewIntervalMs)
    if (typeof (renewTimer as { unref?: () => void }).unref === 'function') {
      ;(renewTimer as { unref: () => void }).unref()
    }
  })

  return {
    close: async () => {
      closed = true
      if (renewTimer) {
        clearInterval(renewTimer)
        renewTimer = null
      }
      await stopSubscription()
      if (leader) {
        leader = false
        try {
          await releaseLeaderLockIfOwner(redis, ACCOUNTING_LOCK_KEY, instanceId)
        } catch (err) {
          logger.warn({ err }, 'shedding: lock release on close failed')
        }
      }
    },
    isLeader: () => leader,
  }
}
