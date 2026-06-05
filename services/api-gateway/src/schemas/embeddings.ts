import { z } from '@hono/zod-openapi'

import { FailedSchema, InProgressSchema, SubmitBodySchema } from './common.ts'

export const EmbeddingSubmitBodySchema = SubmitBodySchema.openapi(
  'EmbeddingSubmitBody',
)

const EmbeddingCompleteSchema = z.object({
  status: z.literal('complete'),
  jobId: z.string(),
  vector: z.array(z.number()),
  dimensions: z.number(),
  embeddingModel: z
    .object({ name: z.string(), version: z.string() })
    .optional(),
  cachedAt: z.string().optional(),
})

export const EmbeddingPollResponseSchema = z
  .union([EmbeddingCompleteSchema, FailedSchema, InProgressSchema])
  .openapi('EmbeddingPollResponse')
