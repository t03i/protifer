import { z } from 'zod'

import type { EffectiveLimits } from './plan.ts'

export type Plan = 'free' | 'pro' | 'enterprise'

export interface AuthContext {
  sub: string
  email: string
  plan: Plan
  limits: EffectiveLimits
  method: 'api-key' | 'session'
  role?: 'admin' | 'user'
}

export const EMBEDDING_MODELS = [
  'prott5_xl_u50',
  'esm2_650m',
  'esm2_3b',
] as const
export type EmbeddingModelName = (typeof EMBEDDING_MODELS)[number]

export const PREDICTION_MODELS = [
  'prott5_secondary_structure',
  'tmbed',
  'seth',
  'bindembed',
  'prott5_conservation',
  'light_attention_subcellular',
  'light_attention_membrane',
  'variation',
] as const
export type PredictionModelName = (typeof PREDICTION_MODELS)[number]

export const EmbeddingModelConfigSchema = z.object({
  name: z.enum(EMBEDDING_MODELS),
  version: z.string(),
})
export type EmbeddingModelConfig = z.infer<typeof EmbeddingModelConfigSchema>

export const PredictionModelVersionSchema = z.object({
  name: z.enum(PREDICTION_MODELS),
  version: z.string(),
})
export type PredictionModelVersion = z.infer<
  typeof PredictionModelVersionSchema
>

export const SecondaryStructureOutputSchema = z.object({
  dssp3: z.string(),
  dssp8: z.string(),
})
export type SecondaryStructureOutput = z.infer<
  typeof SecondaryStructureOutputSchema
>

export const BindingOutputSchema = z.object({
  metal: z.string(),
  nucleicAcids: z.string(),
  smallMolecules: z.string(),
})
export type BindingOutput = z.infer<typeof BindingOutputSchema>

export const VariationOutputSchema = z.object({
  x_axis: z.array(z.string()),
  y_axis: z.array(z.string()),
  values: z.array(z.array(z.number())),
})
export type VariationOutput = z.infer<typeof VariationOutputSchema>

export const MODEL_ERROR_CODES = [
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'INTERNAL',
  'DECODE_ERROR',
  'SHAPE_MISMATCH',
  'DTYPE_MISMATCH',
] as const
export type ModelErrorCode = (typeof MODEL_ERROR_CODES)[number]

export const ModelErrorEntrySchema = z.object({
  code: z.enum(MODEL_ERROR_CODES),
  message: z.string(),
  failedAt: z.string(),
})
export type ModelErrorEntry = z.infer<typeof ModelErrorEntrySchema>

export type ModelErrors = Partial<Record<PredictionModelName, ModelErrorEntry>>

export const TmbedOutputSchema = z.object({
  labels: z.string(),
  probabilities: z.array(z.array(z.number())), // row-major [seqLen][5]
})
export type TmbedOutput = z.infer<typeof TmbedOutputSchema>

// Mapped type, not convertible to Zod.
export type ModelOutputMap = {
  prott5_secondary_structure: SecondaryStructureOutput
  tmbed: TmbedOutput
  seth: number[]
  bindembed: BindingOutput
  prott5_conservation: number[]
  light_attention_subcellular: string
  light_attention_membrane: string
  variation: VariationOutput
}

export type PredictionOutputs = {
  [K in PredictionModelName]?: ModelOutputMap[K]
}

export const StoredPredictionV1Schema = z.object({
  schemaVersion: z.literal(1),
  versions: z.array(PredictionModelVersionSchema),
  outputs: z.record(z.string(), z.unknown()), // PredictionOutputs is a mapped type; use z.record for runtime validation
})
// Override outputs type to preserve strong typing for consumers (mapped type cannot be expressed in Zod)
export type StoredPredictionV1 = Omit<
  z.infer<typeof StoredPredictionV1Schema>,
  'outputs'
> & { outputs: PredictionOutputs }

export const StoredPredictionV2Schema = z.object({
  schemaVersion: z.literal(2),
  versions: z.array(PredictionModelVersionSchema),
  outputs: z.record(z.string(), z.unknown()),
  modelErrors: z.record(z.string(), z.unknown()).optional(),
})
export type StoredPredictionV2 = Omit<
  z.infer<typeof StoredPredictionV2Schema>,
  'outputs' | 'modelErrors'
> & {
  outputs: PredictionOutputs
  modelErrors?: ModelErrors
}

// Discriminated-union reader used by api-gateway and prediction-worker on read.
export const StoredPredictionSchema = z.discriminatedUnion('schemaVersion', [
  StoredPredictionV1Schema,
  StoredPredictionV2Schema,
])

export type StoredPrediction = StoredPredictionV1 | StoredPredictionV2

export const PredictionSuiteConfigSchema = z.object({
  embeddingModel: EmbeddingModelConfigSchema,
  predictionModels: z.array(PredictionModelVersionSchema),
})
export type PredictionSuiteConfig = z.infer<typeof PredictionSuiteConfigSchema>

const SentryTraceSchema = z.object({
  'sentry-trace': z.string(),
  baggage: z.string(),
})

export const EmbeddingJobDataSchema = z.object({
  sequence: z.string(),
  sequenceHash: z.string(),
  accession: z.string().optional(),
  embeddingModel: EmbeddingModelConfigSchema,
  userId: z.string(),
  submittedAt: z.string(),
  // snake_case mirrors the on-the-wire log field; optional so workers tolerate in-flight legacy jobs.
  request_id: z.string().min(1).optional(),
  _sentryTrace: SentryTraceSchema.optional(),
})
export type EmbeddingJobData = z.infer<typeof EmbeddingJobDataSchema>

export const EmbeddingJobResultSchema = z.object({
  embeddingRef: z.string(),
  computedAt: z.string(),
})
export type EmbeddingJobResult = z.infer<typeof EmbeddingJobResultSchema>

export const PredictionJobDataSchema = z.object({
  sequence: z.string(),
  sequenceHash: z.string(),
  accession: z.string().optional(),
  embeddingModel: EmbeddingModelConfigSchema,
  predictionModels: z.array(PredictionModelVersionSchema),
  userId: z.string(),
  submittedAt: z.string(),
  // snake_case mirrors the on-the-wire log field; optional so workers tolerate in-flight legacy jobs.
  request_id: z.string().min(1).optional(),
  _sentryTrace: SentryTraceSchema.optional(),
})
export type PredictionJobData = z.infer<typeof PredictionJobDataSchema>

export const PredictionJobResultSchema = z.object({
  predictionRef: z.string(),
  computedAt: z.string(),
})
export type PredictionJobResult = z.infer<typeof PredictionJobResultSchema>

export const SubmitResponseSchema = z.object({
  jobId: z.string(),
  statusUrl: z.string(),
})
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>

export type JobStatus =
  | 'queued'
  | 'processing'
  | 'complete'
  | 'failed'
  | 'not_found'

// PollResponse: keep as plain type (web app consumer uses type-only import)
export interface PollResponse {
  status: JobStatus
  jobId?: string
  result?: StoredPrediction
  embeddingModel?: EmbeddingModelConfig
  cachedAt?: string
  error?: string
}
