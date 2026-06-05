import { StoredPredictionSchema } from '@protifer/shared'
import { describe, expect, it } from 'vitest'

import { EmbeddingPollResponseSchema } from '../schemas/embeddings.ts'
import { PredictionPollResponseSchema } from '../schemas/predictions.ts'

describe('PredictionPollResponse contract', () => {
  describe('CTRT-01: valid response shapes', () => {
    it('accepts complete with result', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'complete',
        jobId: 'pred_abc',
        result: { schemaVersion: 1, versions: [], outputs: {} },
      })
      expect(parsed.success).toBe(true)
    })

    it('accepts complete with optional embeddingModel and cachedAt', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'complete',
        jobId: 'pred_abc',
        result: { schemaVersion: 1, versions: [], outputs: {} },
        embeddingModel: { name: 'prott5_xl_u50', version: '1' },
        cachedAt: '2025-01-01T00:00:00Z',
      })
      expect(parsed.success).toBe(true)
    })

    it('accepts failed with error', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'failed',
        jobId: 'pred_abc',
        error: 'Worker OOM',
      })
      expect(parsed.success).toBe(true)
    })

    it('accepts queued with only jobId', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'queued',
        jobId: 'pred_abc',
      })
      expect(parsed.success).toBe(true)
    })

    it('accepts processing with only jobId', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'processing',
        jobId: 'pred_abc',
      })
      expect(parsed.success).toBe(true)
    })

    it('accepts not_found with only jobId', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'not_found',
        jobId: 'pred_abc',
      })
      expect(parsed.success).toBe(true)
    })
  })

  describe('CTRT-02: behavioral invariants', () => {
    it('rejects complete without result', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'complete',
        jobId: 'pred_abc',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects failed without error', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'failed',
        jobId: 'pred_abc',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects queued with result', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'queued',
        jobId: 'pred_abc',
        result: { schemaVersion: 1, versions: [], outputs: {} },
      })
      // z.union tries all variants; queued variant uses .strict() so extra fields cause rejection
      expect(parsed.success).toBe(false)
    })

    it('rejects queued with error', () => {
      const parsed = PredictionPollResponseSchema.safeParse({
        status: 'queued',
        jobId: 'pred_abc',
        error: 'should not be here',
      })
      expect(parsed.success).toBe(false)
    })
  })
})

describe('EmbeddingPollResponse contract', () => {
  it('accepts complete with vector and dimensions', () => {
    const parsed = EmbeddingPollResponseSchema.safeParse({
      status: 'complete',
      jobId: 'emb_abc',
      vector: [0.1, 0.2, 0.3],
      dimensions: 3,
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts failed with error', () => {
    const parsed = EmbeddingPollResponseSchema.safeParse({
      status: 'failed',
      jobId: 'emb_abc',
      error: 'Triton connection refused',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects complete without vector', () => {
    const parsed = EmbeddingPollResponseSchema.safeParse({
      status: 'complete',
      jobId: 'emb_abc',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects failed without error', () => {
    const parsed = EmbeddingPollResponseSchema.safeParse({
      status: 'failed',
      jobId: 'emb_abc',
    })
    expect(parsed.success).toBe(false)
  })
})

describe('StoredPrediction discriminated union (V1+V2) — Phase 21-08', () => {
  it('accepts V1 legacy record (schemaVersion: 1)', () => {
    const parsed = StoredPredictionSchema.safeParse({
      schemaVersion: 1,
      versions: [],
      outputs: {},
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts V2 record with modelErrors (schemaVersion: 2)', () => {
    const parsed = StoredPredictionSchema.safeParse({
      schemaVersion: 2,
      versions: [],
      outputs: {
        tmbed: { labels: 'HHi', probabilities: [[0.2, 0.2, 0.2, 0.2, 0.2]] },
      },
      modelErrors: {
        variation: {
          code: 'UNAVAILABLE',
          message: 'server down',
          failedAt: '2026-04-18T00:00:00Z',
        },
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts V2 record without modelErrors (optional)', () => {
    const parsed = StoredPredictionSchema.safeParse({
      schemaVersion: 2,
      versions: [],
      outputs: {},
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects schemaVersion: 99 (no such discriminator variant)', () => {
    const parsed = StoredPredictionSchema.safeParse({
      schemaVersion: 99,
      versions: [],
      outputs: {},
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects missing schemaVersion', () => {
    const parsed = StoredPredictionSchema.safeParse({
      versions: [],
      outputs: {},
    })
    expect(parsed.success).toBe(false)
  })
})

describe('PredictionPollResponse accepts V2 result — Phase 21-08', () => {
  it('accepts complete with V2 result including modelErrors', () => {
    const parsed = PredictionPollResponseSchema.safeParse({
      status: 'complete',
      jobId: 'pred_abc',
      result: {
        schemaVersion: 2,
        versions: [],
        outputs: {},
        modelErrors: {
          vespag: {
            code: 'DEADLINE_EXCEEDED',
            message: 'timeout',
            failedAt: '2026-04-18T00:00:00Z',
          },
        },
      },
    })
    expect(parsed.success).toBe(true)
  })
})
