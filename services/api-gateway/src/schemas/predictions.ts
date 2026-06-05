import { z } from '@hono/zod-openapi'
import {
  StoredPredictionV1Schema,
  StoredPredictionV2Schema,
} from '@protifer/shared'

import { FailedSchema, InProgressSchema, SubmitBodySchema } from './common.ts'

export const PredictionSubmitBodySchema = SubmitBodySchema.openapi(
  'PredictionSubmitBody',
)

// Composed with the OpenAPI-aware `z` (shared's plain-zod `StoredPredictionSchema`
// has no `.openapi`); reuses the shared member schemas so the shape stays in
// sync. Used for both the OpenAPI component and the route's `safeParse`.
export const StoredPredictionSchema = z
  .discriminatedUnion('schemaVersion', [
    StoredPredictionV1Schema,
    StoredPredictionV2Schema,
  ])
  .openapi('StoredPrediction')

const PredictionCompleteSchema = z.object({
  status: z.literal('complete'),
  jobId: z.string(),
  result: StoredPredictionSchema,
  embeddingModel: z
    .object({ name: z.string(), version: z.string() })
    .optional(),
  cachedAt: z.string().optional(),
})

export const PredictionPollResponseSchema = z
  .union([PredictionCompleteSchema, FailedSchema, InProgressSchema])
  .openapi('PredictionPollResponse')
