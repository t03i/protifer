import {
  QUEUE_NAMES,
  createObjectStoreFromConfig,
  createRedisConnection,
  createWorkerMetrics,
  defaultPinoOptions,
  initSentry,
  loadConfigOrExit,
  startMetricsServer,
} from '@protifer/shared'
import { createTritonClient } from '@protifer/triton-client'
import { createWorkerApp } from '@protifer/worker-bootstrap'
import pino from 'pino'

import { ADAPTER_REGISTRY } from './adapters/index.ts'
import { loadConfig } from './config.ts'
import { processPredictionJob } from './processor.ts'

initSentry('prediction-worker')

const config = loadConfigOrExit(loadConfig)

const logger = pino({ name: 'prediction-worker', ...defaultPinoOptions() })
const triton = createTritonClient(config.triton.url)
const store = createObjectStoreFromConfig(config.storage)
const metrics = createWorkerMetrics()

if (config.metrics.enabled) {
  const metricsServer = startMetricsServer({
    registry: metrics.registry,
    port: config.metrics.port,
  })
  process.on('SIGTERM', () => {
    void metricsServer.close()
  })
}

createWorkerApp({
  name: 'prediction-worker',
  queueName: QUEUE_NAMES.PREDICTION,
  models: Object.values(ADAPTER_REGISTRY).map((a) => a.modelName),
  processor: async (job) => {
    logger.info({ jobId: job.id }, 'Processing prediction job')
    return processPredictionJob(job, {
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
