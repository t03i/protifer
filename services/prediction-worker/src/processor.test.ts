import type {
  EmbeddingModelConfig,
  Job,
  ModelErrors,
  PredictionJobData,
  PredictionModelVersion,
  PredictionOutputs,
} from '@protifer/shared'
import {
  computeSequenceHash,
  embeddingRefKey,
  makeInMemoryStore,
  predictionRefKey,
} from '@protifer/shared'
import type { TritonClient } from '@protifer/triton-client'
import { fp32ArrayToFp16Buffer } from '@protifer/triton-client'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import * as dispatchModule from './dispatch.ts'
import { processPredictionJob } from './processor.ts'

const SEQ = 'MKTVRQERLK'
const SEQ_HASH = computeSequenceHash(SEQ)
const EMB_MODEL: EmbeddingModelConfig = { name: 'prott5_xl_u50', version: 'v1' }
const PRED_MODELS: PredictionModelVersion[] = [
  { name: 'prott5_secondary_structure', version: 'v1' },
  { name: 'tmbed', version: 'v1' },
]

// Valid FP16 embedding: seqLen * 1024 * 2 bytes.
const EMB_FP16 = fp32ArrayToFp16Buffer(new Array(SEQ.length * 1024).fill(0.1))

function makeTriton(): TritonClient {
  return {
    modelInfer: vi.fn(),
    modelReady: vi.fn().mockResolvedValue(true),
    serverReady: vi.fn(),
    close: vi.fn(),
  }
}

function makeJob(opts?: { childrenValues?: Record<string, unknown> }): Job {
  return {
    data: {
      sequence: SEQ,
      sequenceHash: SEQ_HASH,
      embeddingModel: EMB_MODEL,
      predictionModels: PRED_MODELS,
      userId: 'u1',
      submittedAt: new Date().toISOString(),
    } satisfies PredictionJobData,
    getChildrenValues: vi.fn().mockResolvedValue(
      opts?.childrenValues ?? {
        'embedding-queue:emb-1': {
          embeddingRef: embeddingRefKey(EMB_MODEL, SEQ_HASH),
          computedAt: new Date().toISOString(),
        },
      },
    ),
    log: vi.fn(),
    updateProgress: vi.fn(),
  } as unknown as Job
}

describe('processPredictionJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when children values are empty (cascaded failure)', async () => {
    const store = makeInMemoryStore()
    await expect(
      processPredictionJob(makeJob({ childrenValues: {} }), {
        store,
        triton: makeTriton(),
      }),
    ).rejects.toThrow('Embedding child job result missing')
  })

  it('throws when child result lacks embeddingRef', async () => {
    const store = makeInMemoryStore()
    await expect(
      processPredictionJob(
        makeJob({ childrenValues: { 'embedding-queue:emb-1': {} } }),
        { store, triton: makeTriton() },
      ),
    ).rejects.toThrow('Embedding child job result missing')
  })

  it('reads FP16, up-converts, dispatches, and writes StoredPredictionV2 without modelErrors when all adapters succeed', async () => {
    const store = makeInMemoryStore(
      new Map([[embeddingRefKey(EMB_MODEL, SEQ_HASH), EMB_FP16]]),
    )
    const outputs: PredictionOutputs = {
      prott5_secondary_structure: {
        dssp3: 'C'.repeat(SEQ.length),
        dssp8: 'C'.repeat(SEQ.length),
      },
      tmbed: { labels: 'i'.repeat(SEQ.length), probabilities: [] },
    }
    vi.spyOn(dispatchModule, 'dispatchAll').mockResolvedValue({
      outputs,
      modelErrors: {} as ModelErrors,
    })

    const result = await processPredictionJob(makeJob(), {
      store,
      triton: makeTriton(),
    })

    expect(result.predictionRef).toBe(
      predictionRefKey(EMB_MODEL, PRED_MODELS, SEQ_HASH),
    )
    const stored = JSON.parse(
      (await store.get(result.predictionRef)).toString('utf8'),
    ) as {
      schemaVersion: number
      outputs: Record<string, unknown>
      modelErrors?: Record<string, unknown>
    }
    expect(stored.schemaVersion).toBe(2)
    expect(Object.keys(stored.outputs)).toEqual(
      expect.arrayContaining(['prott5_secondary_structure', 'tmbed']),
    )
    expect(stored.modelErrors).toBeUndefined()
  })

  it('writes StoredPredictionV2 with modelErrors when dispatch returns partial failures', async () => {
    const store = makeInMemoryStore(
      new Map([[embeddingRefKey(EMB_MODEL, SEQ_HASH), EMB_FP16]]),
    )
    const outputs: PredictionOutputs = {
      prott5_secondary_structure: {
        dssp3: 'C'.repeat(SEQ.length),
        dssp8: 'C'.repeat(SEQ.length),
      },
    }
    const modelErrors: ModelErrors = {
      tmbed: {
        code: 'UNAVAILABLE',
        message: 'server down',
        failedAt: new Date().toISOString(),
      },
    }
    vi.spyOn(dispatchModule, 'dispatchAll').mockResolvedValue({
      outputs,
      modelErrors,
    })

    const result = await processPredictionJob(makeJob(), {
      store,
      triton: makeTriton(),
    })
    const stored = JSON.parse(
      (await store.get(result.predictionRef)).toString('utf8'),
    ) as {
      schemaVersion: number
      modelErrors?: Record<string, unknown>
    }
    expect(stored.schemaVersion).toBe(2)
    expect(stored.modelErrors).toBeDefined()
    expect(Object.keys(stored.modelErrors ?? {})).toEqual(['tmbed'])
  })

  it('throws without writing when all adapters fail (outputs empty)', async () => {
    const store = makeInMemoryStore(
      new Map([[embeddingRefKey(EMB_MODEL, SEQ_HASH), EMB_FP16]]),
    )
    const modelErrors: ModelErrors = {
      prott5_secondary_structure: {
        code: 'UNAVAILABLE',
        message: 'down',
        failedAt: new Date().toISOString(),
      },
      tmbed: {
        code: 'UNAVAILABLE',
        message: 'down',
        failedAt: new Date().toISOString(),
      },
    }
    vi.spyOn(dispatchModule, 'dispatchAll').mockResolvedValue({
      outputs: {} as PredictionOutputs,
      modelErrors,
    })

    await expect(
      processPredictionJob(makeJob(), { store, triton: makeTriton() }),
    ).rejects.toThrow(/All prediction models failed/)
  })

  it('throws when the stored embedding buffer length is not a valid FP16 shape', async () => {
    const badBuf = Buffer.alloc(123) // odd length
    const store = makeInMemoryStore(
      new Map([[embeddingRefKey(EMB_MODEL, SEQ_HASH), badBuf]]),
    )

    await expect(
      processPredictionJob(makeJob(), { store, triton: makeTriton() }),
    ).rejects.toThrow(/FP16/)
  })
})
