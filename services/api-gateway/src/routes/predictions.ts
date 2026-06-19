import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import type { z } from '@hono/zod-openapi'
import {
  DEFAULT_PLAN_PRIORITY,
  QUEUE_NAMES,
  captureSentryTraceHeaders,
  computeEmbeddingJobId,
  computePredictionJobId,
  computeSequenceHash,
  defaultPinoOptions,
  getCorrelation,
  logSubmission,
  predictionRefKey,
} from '@protifer/shared'
import type {
  EmbeddingJobData,
  FlowProducer,
  ObjectStore,
  Plan,
  PredictionJobData,
  PredictionSuiteConfig,
  Queue,
} from '@protifer/shared'
import pino from 'pino'

import { createPollHandler } from './_poll-handler.ts'
import { withinConcurrentJobLimit } from './_utils.ts'
import { trackJob, ACTIVE_JOBS_KEY } from '../cleanup.ts'
import type { RedisCommands } from '../queue.ts'
import {
  JobIdParamSchema,
  JobAcceptedSchema,
  ErrorResponseSchema,
} from '../schemas/common.ts'
import {
  PredictionSubmitBodySchema,
  PredictionPollResponseSchema,
  StoredPredictionSchema,
} from '../schemas/predictions.ts'
import type { Variables } from '../types/hono.ts'

interface RouterDeps {
  embeddingQueue: Queue
  predictionQueue: Queue
  flowProducer: FlowProducer
  store: ObjectStore
  redis: RedisCommands
  suite: PredictionSuiteConfig
  priority?: Record<Plan, number>
}

const submitRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: {
      content: { 'application/json': { schema: PredictionSubmitBodySchema } },
      required: true,
    },
  },
  responses: {
    202: {
      content: { 'application/json': { schema: JobAcceptedSchema } },
      description: 'Prediction job accepted',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Invalid request body',
    },
    429: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Concurrent job limit reached',
    },
    503: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description:
        'Request shed by admission controller. `code` is `OVERLOADED` (queue wait exceeds the plan SLO) or `UPSTREAM_DOWN` (embedding backend unresponsive). `Retry-After` header indicates recommended back-off in seconds.',
    },
  },
})

const pollRoute = createRoute({
  method: 'get',
  path: '/{jobId}',
  request: { params: JobIdParamSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: PredictionPollResponseSchema } },
      description: 'Job status',
    },
    202: {
      content: { 'application/json': { schema: PredictionPollResponseSchema } },
      description: 'Job in progress',
    },
    404: {
      content: { 'application/json': { schema: PredictionPollResponseSchema } },
      description: 'Job not found',
    },
  },
})

export function createPredictionsRouter(
  deps: RouterDeps,
): OpenAPIHono<{ Variables: Variables }> {
  const router = new OpenAPIHono<{ Variables: Variables }>()
  const { embeddingQueue, flowProducer, store, redis, suite } = deps
  const priorityMap = deps.priority ?? DEFAULT_PLAN_PRIORITY

  const submitLogger = pino({
    name: 'api-gateway:predictions-submit',
    ...defaultPinoOptions(),
  })

  router.openapi(submitRoute, async (c) => {
    const { sequence, accession } = c.req.valid('json')
    const { embeddingModel, predictionModels } = suite
    const auth = c.get('auth')
    if (sequence.length > auth.limits.maxSequenceLength) {
      return c.json(
        {
          error: `sequence must be at most ${String(auth.limits.maxSequenceLength)} residues`,
          code: 'VALIDATION_ERROR',
        },
        400,
      )
    }
    const sequenceHash = computeSequenceHash(sequence)
    const embJobId = computeEmbeddingJobId(sequence, embeddingModel)
    const predJobId = computePredictionJobId(
      sequence,
      embeddingModel,
      predictionModels,
    )
    const statusUrl = `/v1/predictions/${predJobId}`

    const existingPredJob = await deps.predictionQueue.getJob(predJobId)
    if (existingPredJob) {
      const state = await existingPredJob.getState()
      if (state !== 'failed') {
        return c.json({ jobId: predJobId, statusUrl }, 202)
      }
    }

    if (!(await withinConcurrentJobLimit(c, redis, auth))) {
      return c.json(
        { error: 'Concurrent job limit reached', code: 'RATE_LIMIT_EXCEEDED' },
        429,
      )
    }

    const now = new Date().toISOString()
    const sentryTrace = captureSentryTraceHeaders()
    const corrRequestId = getCorrelation()?.requestId
    const embeddingData: EmbeddingJobData = {
      sequence,
      sequenceHash,
      ...(accession ? { accession } : {}),
      embeddingModel,
      userId: auth.sub,
      submittedAt: now,
      ...(sentryTrace ? { _sentryTrace: sentryTrace } : {}),
      ...(corrRequestId ? { request_id: corrRequestId } : {}),
    }
    const predictionData: PredictionJobData = {
      sequence,
      sequenceHash,
      ...(accession ? { accession } : {}),
      embeddingModel,
      predictionModels,
      userId: auth.sub,
      submittedAt: now,
      ...(sentryTrace ? { _sentryTrace: sentryTrace } : {}),
      ...(corrRequestId ? { request_id: corrRequestId } : {}),
    }

    const priority = priorityMap[auth.plan]
    logSubmission(submitLogger, {
      userId: auth.sub,
      sequenceHash,
      seqLen: sequence.length,
      embeddingModel,
      predictionModels,
      submittedAt: now,
    })
    await flowProducer.add({
      name: 'prediction',
      queueName: QUEUE_NAMES.PREDICTION,
      opts: { jobId: predJobId, priority },
      data: predictionData,
      children: [
        {
          name: 'embedding',
          queueName: QUEUE_NAMES.EMBEDDING,
          opts: { jobId: embJobId, failParentOnFailure: true, priority },
          data: embeddingData,
        },
      ],
    })

    await redis.zadd(ACTIVE_JOBS_KEY(auth.sub), Date.now(), predJobId)
    await trackJob(redis, auth.sub, predJobId)
    return c.json({ jobId: predJobId, statusUrl }, 202)
  })

  const pollLogger = pino({
    name: 'api-gateway:predictions-poll',
    ...defaultPinoOptions(),
  })

  router.openapi(pollRoute, async (c) => {
    const { jobId } = c.req.valid('param')
    const auth = c.get('auth')

    const handler = createPollHandler<PredictionJobData>({
      kind: 'prediction',
      requesterId: auth.sub,
      getJob: (id) => deps.predictionQueue.getJob(id),
      refKey: ({ sequenceHash, predictionModels, embeddingModel }) =>
        predictionRefKey(embeddingModel, predictionModels, sequenceHash),
      store,
      renderFailed: async ({ jobId: id, job }) => {
        // Map raw worker failure to a generic client message + stable code; the
        // raw reason (Triton model names, internal codes) stays in server logs.
        const rawReason = job.failedReason || 'Unknown error'
        let detail = rawReason
        let code = 'PREDICTION_FAILED'
        let error = 'Prediction failed'
        if (rawReason.startsWith('child ')) {
          const { data } = job
          const embJobId = computeEmbeddingJobId(
            data.sequence,
            data.embeddingModel,
          )
          const embJob = await deps.embeddingQueue.getJob(embJobId)
          const childReason = embJob?.failedReason ?? 'details unavailable'
          detail = `Embedding failed: ${childReason}`
          code = 'EMBEDDING_FAILED'
          error = 'Embedding failed'
        }
        pollLogger.warn(
          { jobId: id, failedReason: detail },
          'prediction job failed',
        )
        return {
          status: 200,
          body: { status: 'failed', jobId: id, error, code },
        }
      },
      renderMissing: ({ jobId: id }) => ({
        status: 200,
        body: {
          status: 'failed',
          jobId: id,
          error: 'Prediction result not found in store',
        },
      }),
      renderCompleted: ({ jobId: id, data, buf }) => {
        let rawJson: unknown
        try {
          rawJson = JSON.parse(buf.toString('utf8'))
        } catch {
          return {
            status: 200,
            body: {
              status: 'failed',
              jobId: id,
              error: 'Corrupt stored prediction (JSON parse)',
            },
          }
        }
        const parsed = StoredPredictionSchema.safeParse(rawJson)
        if (!parsed.success) {
          pollLogger.warn(
            { jobId: id, issues: parsed.error.issues },
            'StoredPrediction schema mismatch — returning failed',
          )
          return {
            status: 200,
            body: {
              status: 'failed',
              jobId: id,
              error: 'Corrupt stored prediction',
            },
          }
        }
        return {
          status: 200,
          body: {
            status: 'complete',
            jobId: id,
            result: parsed.data,
            embeddingModel: data.embeddingModel,
            cachedAt: new Date().toISOString(),
          },
        }
      },
      renderPending: async ({ jobId: id, job, state }) => {
        const { data } = job
        const embJobId = computeEmbeddingJobId(
          data.sequence,
          data.embeddingModel,
        )
        const embJob = await embeddingQueue.getJob(embJobId)
        const embState = embJob ? await embJob.getState() : 'waiting'
        const status =
          embState === 'active' || state === 'active' ? 'processing' : 'queued'
        return { status: 202, body: { status, jobId: id } }
      },
    })

    const { status, body } = await handler(jobId)
    return c.json(
      body as z.infer<typeof PredictionPollResponseSchema>,
      status as 200 | 202 | 404,
    )
  })

  return router
}
