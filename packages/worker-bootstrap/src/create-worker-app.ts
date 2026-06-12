import { createHash } from 'node:crypto'

import { trace as otelTrace } from '@opentelemetry/api'
import type {
  BullMQConnection,
  EmbeddingJobData,
  Logger,
  PredictionJobData,
  Processor,
} from '@protifer/shared'
import {
  UnrecoverableError,
  createWorker as defaultCreateWorker,
  defaultPinoOptions,
  mintRequestId,
  runWithCorrelation,
} from '@protifer/shared'
import type { TritonClient } from '@protifer/triton-client'
import * as Sentry from '@sentry/node'
import pino from 'pino'

type JobDataCarrier = Partial<EmbeddingJobData & PredictionJobData>

const ZERO_SPAN_ID = '0'.repeat(16)

// Deterministic fallback when no OTel span is active: same request_id → same
// trace_id (so all worker logs for one request pivot together), collision-
// resistant across arbitrary inbound id formats.
export function deriveTraceIdFromRequestId(requestId: string): string {
  return createHash('sha256').update(requestId).digest('hex').slice(0, 32)
}

/**
 * A BullMQ `failed` event fires on every attempt. A failure is terminal — and
 * worth escalating to Sentry — only when no retry remains: attempts are
 * exhausted, or the error is an `UnrecoverableError` (which never retries), or
 * there is no job to reason about (capture rather than silently drop).
 */
export function isTerminalJobFailure(
  job: { attemptsMade: number; opts?: { attempts?: number } } | undefined,
  err: unknown,
): boolean {
  if (err instanceof UnrecoverableError) return true
  if (!job) return true
  return job.attemptsMade >= (job.opts?.attempts ?? 1)
}

function wrapProcessorWithSentry<D, R>(
  queueName: string,
  processor: Processor<D, R>,
  logger: Logger,
  isEnabled?: () => Promise<boolean> | boolean,
): Processor<D, R> {
  return async (job, token) => {
    const data = (job.data ?? {}) as JobDataCarrier
    const trace = data._sentryTrace

    const run = () =>
      Sentry.startSpan(
        { name: `${queueName}.process`, op: 'queue.process' },
        async (span) => {
          if (job.id) span.setAttribute('job.id', job.id)
          span.setAttribute('job.queue', queueName)
          span.setAttribute('job.attempt', job.attemptsMade + 1)
          if (data.userId) span.setAttribute('user.id', data.userId)
          const modelVersion =
            data.predictionModels?.[0]?.version ?? data.embeddingModel?.version
          if (modelVersion) span.setAttribute('model.version', modelVersion)

          const enabled = isEnabled ? await isEnabled() : true
          if (!enabled) {
            return processor(job, token)
          }

          let requestId = data.request_id
          if (!requestId) {
            requestId = `worker-${mintRequestId().slice(0, 8)}`
            logger.debug(
              { jobId: job.id },
              'missing request_id on job data — minted worker-side id',
            )
          }
          const activeCtx = otelTrace.getActiveSpan()?.spanContext()
          const traceId =
            activeCtx?.traceId ?? deriveTraceIdFromRequestId(requestId)
          const spanId = activeCtx?.spanId ?? ZERO_SPAN_ID
          return runWithCorrelation(
            {
              requestId,
              traceId,
              spanId,
              ...(data.userId ? { userId: data.userId } : {}),
            },
            () => processor(job, token),
          )
        },
      )

    if (trace) {
      return Sentry.continueTrace(
        { sentryTrace: trace['sentry-trace'], baggage: trace.baggage },
        run,
      )
    }
    return run()
  }
}

/**
 * Close a BullMQ Redis connection if the concrete instance exposes the
 * ioredis `quit`/`disconnect` API. The `BullMQConnection` type is a union
 * that also allows plain option objects (used in tests), so we feature-detect
 * before calling. `quit()` waits for in-flight commands; `disconnect()` is
 * the immediate fallback.
 */
async function closeRedisConnection(
  connection: BullMQConnection,
  logger: Logger,
): Promise<void> {
  const candidate = connection as {
    quit?: () => Promise<unknown>
    disconnect?: () => void
  }
  try {
    if (typeof candidate.quit === 'function') {
      await candidate.quit()
    } else if (typeof candidate.disconnect === 'function') {
      candidate.disconnect()
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to close Redis connection cleanly')
  }
}

export interface CreateWorkerAppOptions<D, R> {
  name: string
  queueName: string
  models: readonly string[]
  processor: Processor<D, R>
  triton: Pick<TritonClient, 'modelReady' | 'close'>
  createWorker?: typeof defaultCreateWorker
  createConnection: () => BullMQConnection
  logger?: Logger
  exit?: (code: number) => void
  registerSigterm?: boolean
  flagCheck?: () => Promise<boolean> | boolean
}

/**
 * Boot a BullMQ worker with a Triton ModelReady gate.
 *
 * Probes each model via `triton.modelReady`; if any probe returns false or
 * throws, calls `exit(1)` (container restart policy handles retries).
 * Only after all probes succeed does the worker start consuming jobs.
 *
 * Registers a SIGTERM handler by default that drains the worker and closes
 * the Triton connection before exiting.
 */
export async function createWorkerApp<D, R>(
  opts: CreateWorkerAppOptions<D, R>,
): Promise<void> {
  const {
    name,
    queueName,
    models,
    processor,
    triton,
    createWorker = defaultCreateWorker,
    createConnection,
    registerSigterm = true,
    flagCheck,
  } = opts
  const logger = opts.logger ?? pino({ name, ...defaultPinoOptions() })
  const exit: (code: number) => void =
    opts.exit ?? ((code: number) => process.exit(code))

  const connection = createConnection()
  const wrappedProcessor = wrapProcessorWithSentry(
    queueName,
    processor,
    logger,
    flagCheck,
  )
  const worker = createWorker<D, R>(queueName, wrappedProcessor, connection, {
    autorun: false,
  })

  worker.on('completed', (job) => {
    const requestId = (job.data as { request_id?: string } | undefined)
      ?.request_id
    logger.info(
      { jobId: job.id, request_id: requestId },
      `${name} job completed`,
    )
  })
  worker.on('failed', (job, err) => {
    const requestId = (job?.data as { request_id?: string } | undefined)
      ?.request_id
    logger.error(
      { jobId: job?.id, request_id: requestId, err },
      `${name} job failed`,
    )

    // Escalate to Sentry only once the job is terminally failed — not on every
    // intermediate retry — so a transient blip that later succeeds (or simply
    // retries) doesn't open duplicate issues.
    if (!isTerminalJobFailure(job, err)) return

    Sentry.withScope((scope) => {
      if (job?.id) scope.setTag('job.id', job.id)
      scope.setTag('job.queue', queueName)
      if (job) scope.setTag('job.attempt', String(job.attemptsMade))
      if (requestId) scope.setTag('request_id', requestId)
      const userId = (job?.data as { userId?: string } | undefined)?.userId
      if (userId) scope.setUser({ id: userId })
      Sentry.captureException(err)
    })
  })
  worker.on('error', (err) => {
    logger.error({ err }, 'bullmq worker error')
    Sentry.captureException(err)
  })

  for (const model of models) {
    try {
      const ready = await triton.modelReady(model)
      if (!ready) {
        logger.error({ model }, 'Model not ready — exiting')
        exit(1)
        return
      }
    } catch (err) {
      logger.error({ model, err }, 'ModelReady check failed — exiting')
      exit(1)
      return
    }
    logger.info({ model }, 'ModelReady ok')
  }

  if (registerSigterm) {
    process.on('SIGTERM', () => {
      void (async () => {
        logger.info('SIGTERM received — draining worker')
        await worker.close()
        await closeRedisConnection(connection, logger)
        triton.close()
        exit(0)
      })()
    })
  }

  await worker.run()
  logger.info({ modelCount: models.length, queueName }, `${name} consuming`)
}
