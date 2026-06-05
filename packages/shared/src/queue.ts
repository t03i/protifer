import { Queue, Worker, FlowProducer, QueueEvents } from 'bullmq'
import type { QueueOptions, WorkerOptions, Processor } from 'bullmq'
import IORedis from 'ioredis'

export { Queue, FlowProducer, QueueEvents }
export type { Worker, Job, WorkerOptions, FlowJob, Processor } from 'bullmq'
export type { Redis } from 'ioredis'

export const QUEUE_NAMES = {
  EMBEDDING: 'embedding',
  PREDICTION: 'prediction',
} as const

export type BullMQConnection = QueueOptions['connection']

export interface RedisConnectionConfig {
  host: string
  port: number
  password?: string
}

/**
 * Build a BullMQ-compatible ioredis connection. Callers must pass `cfg` so
 * file-mounted `_FILE` secrets flow through the typed config layer rather than
 * leaking into ad-hoc `process.env` reads.
 */
export function createRedisConnection(
  cfg: RedisConnectionConfig,
): BullMQConnection {
  return new IORedis({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }) as BullMQConnection
}

// Retry backoff sized for Triton restarts (rolling deploys, GPU driver resets),
// which take several minutes. Exponential 30s/60s/120s/240s gives a ~7.5min
// retry window before final failure, clearing a typical restart without failing
// jobs on ordinary deploys. DLQ for terminal failures tracked separately.
export const DEFAULT_JOB_OPTIONS: QueueOptions['defaultJobOptions'] = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 100 },
}

export function createQueue(
  name: string,
  connection: BullMQConnection,
  opts?: Partial<QueueOptions>,
): Queue {
  return new Queue(name, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    ...opts,
  })
}

export function createFlowProducer(connection: BullMQConnection): FlowProducer {
  return new FlowProducer({ connection })
}

// Rate-limit invariant: Worker.limiter is queue-wide in BullMQ v5 (enforced via
// Redis across all workers on the queue). QUEUE_RATE_LIMIT_MAX is the total
// jobs/sec cap for the whole queue; WORKER_CONCURRENCY is per-worker parallelism
// and must be ≤ QUEUE_RATE_LIMIT_MAX so one worker can't saturate the global
// limit. Holds while total workers × WORKER_CONCURRENCY ≤ QUEUE_RATE_LIMIT_MAX
// (e.g. 5 workers at concurrency 4 fit within 20/s).
export const QUEUE_RATE_LIMIT_MAX = 20
export const QUEUE_RATE_LIMIT_DURATION_MS = 1_000
export const WORKER_CONCURRENCY = 4

// Lock timing: a Triton inference can take several minutes, and brief Redis
// hiccups can delay a lock renewal attempt. We size `lockDuration` for the
// worst-case inference + a Redis blip, and keep `lockRenewTime` well under
// `lockDuration / 2` so a single failed renewal never loses the lock
// (30_000 / 300_000 = 1/10 — comfortably below BullMQ's recommended /2 bound).
export const WORKER_DEFAULTS: Partial<WorkerOptions> = {
  concurrency: WORKER_CONCURRENCY,
  limiter: {
    max: QUEUE_RATE_LIMIT_MAX,
    duration: QUEUE_RATE_LIMIT_DURATION_MS,
  },
  lockDuration: 300_000,
  lockRenewTime: 30_000,
  maxStalledCount: 2,
}

/**
 * Options for {@link createWorker}. Mirrors BullMQ's `WorkerOptions`; pass
 * `autorun: false` to gate `worker.run()` behind an external boot check
 * (e.g. the ModelReady gate in the prediction/embedding workers).
 */
type CreateWorkerOptions = Partial<WorkerOptions>

export function createWorker<D, R>(
  name: string,
  processor: Processor<D, R>,
  connection: BullMQConnection,
  opts?: CreateWorkerOptions,
): Worker<D, R> {
  return new Worker<D, R>(name, processor, {
    connection,
    ...WORKER_DEFAULTS,
    ...opts,
  })
}
