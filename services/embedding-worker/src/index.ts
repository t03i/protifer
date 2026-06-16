import {
  QUEUE_NAMES,
  createObjectStoreFromConfig,
  createRedisConnection,
  createWorkerMetrics,
  defaultPinoOptions,
  initSentry,
  loadConfigOrExit,
  startMetricsServer,
  sweepFilesystemBudget,
} from '@protifer/shared'
import { createTritonClient } from '@protifer/triton-client'
import { createWorkerApp } from '@protifer/worker-bootstrap'
import pino from 'pino'

import { loadConfig } from './config.ts'
import { processEmbeddingJob } from './processor.ts'

initSentry('embedding-worker')

const config = loadConfigOrExit(loadConfig)

const logger = pino({ name: 'embedding-worker', ...defaultPinoOptions() })
const triton = createTritonClient(config.triton.url)
const store = createObjectStoreFromConfig(config.storage)
const metrics = createWorkerMetrics()

const metricsServer = config.metrics.enabled
  ? startMetricsServer({
      registry: metrics.registry,
      port: config.metrics.port,
    })
  : undefined

let sweepTimer: ReturnType<typeof setInterval> | undefined

if (config.storage.driver === 'filesystem' && config.storage.maxBytes > 0) {
  const { maxBytes, sweepIntervalMs, path: storagePath } = config.storage
  const runSweep = () => {
    sweepFilesystemBudget({
      root: storagePath,
      maxBytes,
      delete: (key) => store.delete(key),
    })
      .then(({ evicted, freedBytes }) => {
        if (evicted.length > 0) {
          logger.info({ evicted: evicted.length, freedBytes }, 'Eviction sweep')
        }
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'Eviction sweep error')
      })
  }
  sweepTimer = setInterval(runSweep, sweepIntervalMs)
  sweepTimer.unref()
}

process.on('SIGTERM', () => {
  if (sweepTimer !== undefined) clearInterval(sweepTimer)
  metricsServer?.close().catch(() => undefined)
})

createWorkerApp({
  name: 'embedding-worker',
  queueName: QUEUE_NAMES.EMBEDDING,
  models: ['prot_t5_pipeline'],
  processor: async (job) => {
    logger.info({ jobId: job.id }, 'Processing embedding job')
    return processEmbeddingJob(job, {
      triton,
      store,
      deadlineMs: config.triton.deadlineMs,
      metrics,
    })
  },
  triton,
  logger,
  createConnection: () =>
    createRedisConnection({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
    }),
}).catch((err: unknown) => {
  logger.error({ err }, 'Boot gate unexpected error')
  process.exit(1)
})
