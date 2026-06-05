import { describe, it, expect } from 'vitest'

import {
  StoredPredictionSchema,
  TmbedOutputSchema,
  ModelErrorEntrySchema,
} from './types.ts'
import type {
  StoredPrediction,
  StoredPredictionV1,
  StoredPredictionV2,
} from './types.ts'

describe('StoredPredictionSchema', () => {
  it('parses a V1 record (legacy path preserved)', () => {
    const result = StoredPredictionSchema.safeParse({
      schemaVersion: 1,
      versions: [],
      outputs: {},
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1)
    }
  })

  it('parses a V2 record with modelErrors', () => {
    const result = StoredPredictionSchema.safeParse({
      schemaVersion: 2,
      versions: [],
      outputs: {},
      modelErrors: {
        vespag: {
          code: 'UNAVAILABLE',
          message: 'up',
          failedAt: '2026-04-18T00:00:00Z',
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.schemaVersion).toBe(2)
    }
  })

  it('parses a V2 record without modelErrors (optional field)', () => {
    const result = StoredPredictionSchema.safeParse({
      schemaVersion: 2,
      versions: [],
      outputs: {},
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.schemaVersion).toBe(2)
    }
  })

  it('rejects schemaVersion: 3 (no discriminator variant)', () => {
    const result = StoredPredictionSchema.safeParse({
      schemaVersion: 3,
      versions: [],
      outputs: {},
    })
    expect(result.success).toBe(false)
  })

  it('compile-time: StoredPrediction accepts V1 | V2 union assignment', () => {
    // Confirms the type assignment compiles; runtime check is trivial.
    function acceptsPrediction(_v: StoredPrediction) {
      void _v
    }
    acceptsPrediction({} as StoredPredictionV1 | StoredPredictionV2)
    expect(true).toBe(true)
  })
})

describe('TmbedOutputSchema', () => {
  it('parses valid TmbedOutput with labels and probabilities', () => {
    const result = TmbedOutputSchema.safeParse({
      labels: 'BBHH',
      probabilities: [[0.1, 0.2, 0.3, 0.1, 0.3]],
    })
    expect(result.success).toBe(true)
  })

  it('rejects TmbedOutput missing probabilities', () => {
    const result = TmbedOutputSchema.safeParse({
      labels: 'BB',
    })
    expect(result.success).toBe(false)
  })

  it('rejects TmbedOutput missing labels', () => {
    const result = TmbedOutputSchema.safeParse({
      probabilities: [[0.1, 0.2, 0.3, 0.1, 0.3]],
    })
    expect(result.success).toBe(false)
  })
})

describe('ModelErrorEntrySchema', () => {
  it('rejects an entry missing failedAt', () => {
    const result = ModelErrorEntrySchema.safeParse({
      code: 'UNAVAILABLE',
      message: 'service down',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a code value not in MODEL_ERROR_CODES', () => {
    const result = ModelErrorEntrySchema.safeParse({
      code: 'PANIC',
      message: 'something went wrong',
      failedAt: '2026-04-18T00:00:00Z',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid ModelErrorEntry', () => {
    const result = ModelErrorEntrySchema.safeParse({
      code: 'INTERNAL',
      message: 'internal error',
      failedAt: '2026-04-18T00:00:00Z',
    })
    expect(result.success).toBe(true)
  })
})
