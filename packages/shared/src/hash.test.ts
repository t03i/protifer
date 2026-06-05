import { describe, it, expect } from 'vitest'

import {
  computeSequenceHash,
  computeEmbeddingJobId,
  computePredictionJobId,
  embeddingRefKey,
  predictionRefKey,
} from './hash.ts'
import type { EmbeddingModelConfig, PredictionModelVersion } from './types.ts'

const EMB: EmbeddingModelConfig = { name: 'prott5_xl_u50', version: 'v1' }
const PRED: PredictionModelVersion[] = [
  { name: 'tmbed', version: 'v1' },
  { name: 'seth', version: 'v1' },
]

describe('computeSequenceHash', () => {
  it('returns a 64-char hex string', () => {
    expect(
      computeSequenceHash(
        'MKTVRQERLKSIVRILERSKEPVSGAQLAEELSVSRQVIVQDIAYLRSLGYNIVATPRGYVLAGG',
      ),
    ).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic', () => {
    const seq = 'ACDEFGHIKLMNPQRSTVWY'
    expect(computeSequenceHash(seq)).toBe(computeSequenceHash(seq))
  })

  it('differs for different sequences', () => {
    expect(computeSequenceHash('AAAA')).not.toBe(computeSequenceHash('BBBB'))
  })
})

describe('computeEmbeddingJobId', () => {
  it('differs for different embedding model names', () => {
    const emb2: EmbeddingModelConfig = { name: 'esm2_650m', version: 'v1' }
    expect(computeEmbeddingJobId('ACDE', EMB)).not.toBe(
      computeEmbeddingJobId('ACDE', emb2),
    )
  })

  it('differs for different embedding model versions', () => {
    const emb2: EmbeddingModelConfig = { name: 'prott5_xl_u50', version: 'v2' }
    expect(computeEmbeddingJobId('ACDE', EMB)).not.toBe(
      computeEmbeddingJobId('ACDE', emb2),
    )
  })
})

describe('computePredictionJobId', () => {
  it('differs when prediction model versions change', () => {
    const pred2: PredictionModelVersion[] = [
      { name: 'tmbed', version: 'v2' },
      { name: 'seth', version: 'v1' },
    ]
    expect(computePredictionJobId('ACDE', EMB, PRED)).not.toBe(
      computePredictionJobId('ACDE', EMB, pred2),
    )
  })

  it('is stable regardless of array insertion order', () => {
    const pred1: PredictionModelVersion[] = [
      { name: 'tmbed', version: 'v1' },
      { name: 'seth', version: 'v1' },
    ]
    const pred2: PredictionModelVersion[] = [
      { name: 'seth', version: 'v1' },
      { name: 'tmbed', version: 'v1' },
    ]
    expect(computePredictionJobId('ACDE', EMB, pred1)).toBe(
      computePredictionJobId('ACDE', EMB, pred2),
    )
  })
})

describe('embeddingRefKey', () => {
  it('incorporates model name and version in path', () => {
    expect(embeddingRefKey(EMB, 'abc123')).toBe('emb/prott5_xl_u50/v1/abc123')
  })
})

describe('predictionRefKey', () => {
  it('uses a stable hash of the full config as path segment', () => {
    const key = predictionRefKey(EMB, PRED, 'abc123')
    expect(key).toMatch(/^pred\/[a-f0-9]{16,}\/abc123$/)
  })

  it('is stable regardless of array insertion order', () => {
    const pred1: PredictionModelVersion[] = [
      { name: 'tmbed', version: 'v1' },
      { name: 'seth', version: 'v1' },
    ]
    const pred2: PredictionModelVersion[] = [
      { name: 'seth', version: 'v1' },
      { name: 'tmbed', version: 'v1' },
    ]
    expect(predictionRefKey(EMB, pred1, 'abc123')).toBe(
      predictionRefKey(EMB, pred2, 'abc123'),
    )
  })

  it('differs when embedding model version changes', () => {
    const emb2: EmbeddingModelConfig = { name: 'prott5_xl_u50', version: 'v2' }
    expect(predictionRefKey(EMB, PRED, 'abc123')).not.toBe(
      predictionRefKey(emb2, PRED, 'abc123'),
    )
  })
})
