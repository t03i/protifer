import { z } from '@hono/zod-openapi'
import { MAX_SEQUENCE_LENGTH } from '@protifer/shared'

/** Shared submit body (sequence + optional accession). Domains attach their own `.openapi()` label. */
export const SubmitBodySchema = z.object({
  sequence: z
    .string()
    .min(1, 'sequence is required and must be non-empty')
    .max(
      MAX_SEQUENCE_LENGTH,
      `sequence must be at most ${String(MAX_SEQUENCE_LENGTH)} residues`,
    )
    .openapi({ example: 'MKTVRQERLK' }),
  accession: z.string().optional().openapi({
    example: 'P04637',
    description:
      'Optional UniProt accession that produced the sequence. Used for display and logging.',
  }),
})

/** Terminal-failure poll branch, shared across domains (inlined into each poll union). */
export const FailedSchema = z.object({
  status: z.literal('failed'),
  jobId: z.string(),
  error: z.string(),
  code: z.string().optional(),
})

/** Non-terminal poll branch, shared across domains (inlined into each poll union). */
export const InProgressSchema = z
  .object({
    status: z.enum(['queued', 'processing', 'not_found']),
    jobId: z.string(),
  })
  .strict()

export const ErrorResponseSchema = z.object({
  error: z.string().openapi({ example: 'Bad request' }),
  code: z.string().optional().openapi({ example: 'VALIDATION_ERROR' }),
})

export const JobIdParamSchema = z.object({
  jobId: z.string().openapi({ example: 'pred_abc123' }),
})

export const JobAcceptedSchema = z.object({
  jobId: z.string().openapi({ example: 'pred_abc123' }),
  statusUrl: z.string().openapi({ example: '/v1/predictions/pred_abc123' }),
})
