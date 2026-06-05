import type { PipelinePromMetrics } from './metrics.ts'

export const FAILURE_REASON_CLASSES = [
  'embedding_cascade',
  'triton_unavailable',
  'worker_oom',
  'timeout',
  'other',
] as const

export type FailureReasonClass = (typeof FAILURE_REASON_CLASSES)[number]

/**
 * Map a BullMQ `failedReason` onto the closed reason taxonomy. Raw error
 * strings never become label values — only these enum members do.
 *
 * Patterns are grounded in real failure messages:
 * - `failParentOnFailure` fails the parent with `child <key> failed`
 *   (see routes/predictions.ts cascade handling).
 * - @grpc/grpc-js renders `14 UNAVAILABLE: ...` / `4 DEADLINE_EXCEEDED: ...`.
 */
export function classifyFailureReason(
  failedReason: string | undefined,
): FailureReasonClass {
  const reason = (failedReason ?? '').toLowerCase()
  if (reason.startsWith('child ')) return 'embedding_cascade'
  if (/unavailable|econnrefused|no connection established/.test(reason)) {
    return 'triton_unavailable'
  }
  if (/out of memory|\boom\b|heap limit/.test(reason)) return 'worker_oom'
  if (/deadline exceeded|timed? ?out/.test(reason)) return 'timeout'
  return 'other'
}

interface PipelineQueueEvents {
  on: ((
    event: 'completed',
    listener: (args: { jobId: string }) => void,
  ) => unknown) &
    ((
      event: 'failed',
      listener: (args: { jobId: string; failedReason: string }) => void,
    ) => unknown) &
    ((event: 'stalled', listener: (args: { jobId: string }) => void) => unknown)
}

interface PipelineJob {
  timestamp: number
  processedOn?: number
  finishedOn?: number
  attemptsMade: number
}

interface PipelineQueue {
  name: string
  getJob: (jobId: string) => Promise<PipelineJob | null | undefined>
}

/**
 * Hook latency/failure/retry/stalled metrics onto an existing QueueEvents
 * instance. Timestamps ride on the job object, so terminal events trigger a
 * single `getJob` fetch; metrics are best-effort and never throw.
 */
export function attachPipelineMetrics(opts: {
  events: PipelineQueueEvents
  queue: PipelineQueue
  metrics: PipelinePromMetrics
}): void {
  const { events, queue, metrics } = opts
  const labels = { queue: queue.name }

  async function onCompleted(jobId: string) {
    const job = await queue.getJob(jobId)
    if (!job) return
    const { timestamp, processedOn, finishedOn, attemptsMade } = job
    if (processedOn) {
      metrics.bullmqJobWaitDuration.observe(
        labels,
        (processedOn - timestamp) / 1000,
      )
    }
    if (finishedOn && processedOn) {
      metrics.bullmqJobProcessingDuration.observe(
        labels,
        (finishedOn - processedOn) / 1000,
      )
    }
    if (finishedOn) {
      metrics.bullmqJobTotalDuration.observe(
        labels,
        (finishedOn - timestamp) / 1000,
      )
    }
    if (attemptsMade >= 1) {
      metrics.bullmqJobAttempts.observe(labels, attemptsMade)
    }
    if (attemptsMade > 1) {
      metrics.bullmqJobRetries.inc(labels, attemptsMade - 1)
    }
  }

  async function onFailed(jobId: string) {
    const job = await queue.getJob(jobId)
    if (job && job.attemptsMade > 1) {
      metrics.bullmqJobRetries.inc(labels, job.attemptsMade - 1)
    }
  }

  events.on('completed', ({ jobId }) => {
    onCompleted(jobId).catch(() => {
      // transient Redis blip — metrics are best-effort
    })
  })
  events.on('failed', ({ jobId, failedReason }) => {
    metrics.bullmqJobFailures.inc(
      { queue: queue.name, reason_class: classifyFailureReason(failedReason) },
      1,
    )
    onFailed(jobId).catch(() => {
      // transient Redis blip — metrics are best-effort
    })
  })
  events.on('stalled', () => {
    metrics.bullmqStalled.inc(labels, 1)
  })
}

interface StaleChildrenRedis {
  zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
  ): Promise<string[]>
  zscore(key: string, member: string): Promise<string | null>
}

/**
 * Build the FAIL-04 backstop scan: gauge prediction jobs stuck in
 * `waiting-children` beyond the threshold and the age of the oldest one.
 * Observe-only — queue wait is not evidence of failure, so nothing is
 * failed, promoted, or removed. Runs on the job-cleanup leader sweep.
 *
 * Reads BullMQ's `waiting-children` ZSET directly (score = when the job
 * entered the state) instead of hydrating job objects — one ZRANGEBYSCORE
 * per sweep regardless of how many jobs are waiting.
 */
export function createStaleChildrenScan(opts: {
  redis: StaleChildrenRedis
  /** BullMQ waiting-children ZSET key, e.g. `queue.toKey('waiting-children')`. */
  waitingChildrenKey: string
  metrics: Pick<
    PipelinePromMetrics,
    'bullmqStaleChildrenJobs' | 'bullmqStaleChildrenOldest'
  >
  thresholdMs: number
  clock?: { now: () => number }
}): () => Promise<void> {
  const { redis, waitingChildrenKey, metrics, thresholdMs } = opts
  const now = opts.clock?.now ?? Date.now

  return async () => {
    const ts = now()
    const stale = await redis.zrangebyscore(
      waitingChildrenKey,
      '-inf',
      ts - thresholdMs,
    )
    const [oldestId] = stale
    metrics.bullmqStaleChildrenJobs.set(stale.length)
    if (oldestId === undefined) {
      metrics.bullmqStaleChildrenOldest.set(0)
      return
    }
    // Ascending by score — the first member is the oldest. A null score
    // means the job left the state between calls; next sweep corrects.
    const score = await redis.zscore(waitingChildrenKey, oldestId)
    metrics.bullmqStaleChildrenOldest.set(
      score === null ? 0 : (ts - Number(score)) / 1000,
    )
  }
}
