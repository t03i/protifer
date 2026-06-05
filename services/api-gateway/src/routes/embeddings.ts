import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  DEFAULT_PLAN_PRIORITY,
  captureSentryTraceHeaders,
  computeEmbeddingJobId,
  computeSequenceHash,
  defaultPinoOptions,
  embeddingRefKey,
  getCorrelation,
  logSubmission,
} from '@protifer/shared'
import type {
  EmbeddingJobData,
  ObjectStore,
  Plan,
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
  EmbeddingSubmitBodySchema,
  EmbeddingPollResponseSchema,
} from '../schemas/embeddings.ts'
import type { Variables } from '../types/hono.ts'

interface RouterDeps {
  embeddingQueue: Queue
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
      content: { 'application/json': { schema: EmbeddingSubmitBodySchema } },
      required: true,
    },
  },
  responses: {
    202: {
      content: { 'application/json': { schema: JobAcceptedSchema } },
      description: 'Embedding job accepted',
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
      content: {
        'application/json': { schema: EmbeddingPollResponseSchema },
        'application/octet-stream': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
      description: 'Job complete',
    },
    202: {
      content: { 'application/json': { schema: EmbeddingPollResponseSchema } },
      description: 'Job in progress',
    },
    404: {
      content: { 'application/json': { schema: EmbeddingPollResponseSchema } },
      description: 'Job not found',
    },
  },
})

export function createEmbeddingsRouter(
  deps: RouterDeps,
): OpenAPIHono<{ Variables: Variables }> {
  const router = new OpenAPIHono<{ Variables: Variables }>()
  const { embeddingQueue, store, redis, suite } = deps
  const priorityMap = deps.priority ?? DEFAULT_PLAN_PRIORITY

  const submitLogger = pino({
    name: 'api-gateway:embeddings-submit',
    ...defaultPinoOptions(),
  })

  router.openapi(submitRoute, async (c) => {
    const { sequence, accession } = c.req.valid('json')
    const { embeddingModel } = suite
    const auth = c.get('auth')
    const sequenceHash = computeSequenceHash(sequence)
    const jobId = computeEmbeddingJobId(sequence, embeddingModel)
    const statusUrl = `/v1/embeddings/${jobId}`

    const existingJob = await embeddingQueue.getJob(jobId)
    if (existingJob) {
      const state = await existingJob.getState()
      if (state !== 'failed') {
        return c.json({ jobId, statusUrl }, 202)
      }
    }

    if (!(await withinConcurrentJobLimit(c, redis, auth))) {
      return c.json(
        { error: 'Concurrent job limit reached', code: 'RATE_LIMIT_EXCEEDED' },
        429,
      )
    }

    const sentryTrace = captureSentryTraceHeaders()
    const corrRequestId = getCorrelation()?.requestId
    const data: EmbeddingJobData = {
      sequence,
      sequenceHash,
      ...(accession ? { accession } : {}),
      embeddingModel,
      userId: auth.sub,
      submittedAt: new Date().toISOString(),
      ...(sentryTrace ? { _sentryTrace: sentryTrace } : {}),
      ...(corrRequestId ? { request_id: corrRequestId } : {}),
    }
    const priority = priorityMap[auth.plan]
    logSubmission(submitLogger, {
      userId: auth.sub,
      sequenceHash,
      seqLen: sequence.length,
      embeddingModel,
      predictionModels: [],
      submittedAt: data.submittedAt,
    })
    await embeddingQueue.add('embedding', data, { jobId, priority })
    await redis.zadd(ACTIVE_JOBS_KEY(auth.sub), Date.now(), jobId)
    await trackJob(redis, auth.sub, jobId)

    return c.json({ jobId, statusUrl }, 202)
  })

  router.openapi(pollRoute, async (c) => {
    const { jobId } = c.req.valid('param')
    const auth = c.get('auth')
    const accept = c.req.header('accept') ?? ''

    // Binary short-circuit: if client wants octet-stream and the job is
    // complete with the payload in the store, stream it directly. This
    // cannot go through the JSON factory.
    let cachedJob: Awaited<ReturnType<typeof embeddingQueue.getJob>> | undefined
    if (accept.includes('application/octet-stream')) {
      cachedJob = await embeddingQueue.getJob(jobId)
      if (cachedJob) {
        // Ownership check before serving binary data (IDOR guard).
        if ((cachedJob.data as EmbeddingJobData).userId !== auth.sub) {
          return c.json({ status: 'not_found', jobId }, 404)
        }
        if ((await cachedJob.getState()) === 'completed') {
          const { sequenceHash, embeddingModel } =
            cachedJob.data as EmbeddingJobData
          const embRef = embeddingRefKey(embeddingModel, sequenceHash)
          if (await store.exists(embRef)) {
            const buf = await store.get(embRef)
            return new Response(buf, {
              status: 200,
              headers: { 'Content-Type': 'application/octet-stream' },
            })
          }
        }
      }
    }

    const handler = createPollHandler<EmbeddingJobData>({
      kind: 'embedding',
      requesterId: auth.sub,
      getJob: (id) =>
        cachedJob !== undefined
          ? Promise.resolve(cachedJob)
          : embeddingQueue.getJob(id),
      refKey: ({ sequenceHash, embeddingModel }) =>
        embeddingRefKey(embeddingModel, sequenceHash),
      store,
      renderCompleted: ({ jobId: id, data, buf }) => {
        const vector: number[] = []
        for (let i = 0; i < buf.length; i += 4) {
          vector.push(buf.readFloatLE(i))
        }
        return {
          status: 200,
          body: {
            status: 'complete',
            jobId: id,
            vector,
            dimensions: vector.length,
            embeddingModel: data.embeddingModel,
            cachedAt: new Date().toISOString(),
          },
        }
      },
    })

    const { status, body } = await handler(jobId)
    return c.json(body, status as 200 | 202 | 404)
  })

  return router
}
