/**
 * Unit-level integration (no docker-compose): runs the real prediction-worker
 * `processPredictionJob` against a mocked `dispatchAll` and an in-memory
 * ObjectStore, then parses the written record through `StoredPredictionSchema`.
 * Validates processor-level composition and schema conformance; adapters and
 * dispatch fan-out are covered by their own unit tests.
 */
import type {
  EmbeddingModelConfig,
  Job,
  ModelErrors,
  PredictionJobData,
  PredictionModelVersion,
  PredictionOutputs,
} from '@protifer/shared'
import {
  StoredPredictionSchema,
  computeSequenceHash,
  embeddingRefKey,
  makeInMemoryStore,
  predictionRefKey,
} from '@protifer/shared'
import type { TritonClient } from '@protifer/triton-client'
import { fp32ArrayToFp16Buffer } from '@protifer/triton-client'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import * as dispatchModule from '../../../prediction-worker/src/dispatch.ts'
import { processPredictionJob } from '../../../prediction-worker/src/processor.ts'

const SEQ = 'MKTVRQERLK'
const SEQ_HASH = computeSequenceHash(SEQ)
const EMB_MODEL: EmbeddingModelConfig = { name: 'prott5_xl_u50', version: 'v1' }
const PRED_MODELS: PredictionModelVersion[] = [
  { name: 'prott5_secondary_structure', version: 'v1' },
  { name: 'tmbed', version: 'v1' },
]

const EMB_FP16 = fp32ArrayToFp16Buffer(new Array(SEQ.length * 1024).fill(0.1))

function makeJob(): Job {
  return {
    data: {
      sequence: SEQ,
      sequenceHash: SEQ_HASH,
      embeddingModel: EMB_MODEL,
      predictionModels: PRED_MODELS,
      userId: 'u1',
      submittedAt: new Date().toISOString(),
    } satisfies PredictionJobData,
    getChildrenValues: vi.fn().mockResolvedValue({
      'embedding-queue:emb-1': {
        embeddingRef: embeddingRefKey(EMB_MODEL, SEQ_HASH),
        computedAt: new Date().toISOString(),
      },
    }),
    log: vi.fn(),
    updateProgress: vi.fn(),
  } as unknown as Job
}

function makeTriton(): TritonClient {
  return {
    modelInfer: vi.fn(),
    modelReady: vi.fn().mockResolvedValue(true),
    serverReady: vi.fn(),
    close: vi.fn(),
  }
}

describe('Prediction pipeline integration — WORKER-04 (Phase 21-08)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('happy path: 8-adapter fan-out produces StoredPredictionV2 with all expected shapes', async () => {
    const store = makeInMemoryStore(
      new Map([[embeddingRefKey(EMB_MODEL, SEQ_HASH), EMB_FP16]]),
    )
    const outputs: PredictionOutputs = {
      prott5_secondary_structure: {
        dssp3: 'C'.repeat(SEQ.length),
        dssp8: 'C'.repeat(SEQ.length),
      },
      tmbed: {
        labels: 'i'.repeat(SEQ.length),
        probabilities: Array.from({ length: SEQ.length }, () => [
          0.2, 0.2, 0.2, 0.2, 0.2,
        ]),
      },
      seth: new Array(SEQ.length).fill(0.05),
      bindembed: {
        metal: '-'.repeat(SEQ.length),
        nucleicAcids: '-'.repeat(SEQ.length),
        smallMolecules: 'b'.repeat(SEQ.length),
      },
      prott5_conservation: new Array(SEQ.length).fill(5),
      variation: { x_axis: [], y_axis: [], values: [] },
      light_attention_subcellular: 'Cytoplasm',
      light_attention_membrane: 'Not-Membrane',
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

    const raw = await store.get(result.predictionRef)
    const parsed = StoredPredictionSchema.safeParse(
      JSON.parse(raw.toString('utf8')),
    )
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const stored = parsed.data
    expect(stored.schemaVersion).toBe(2)
    const v2Outputs = stored.outputs as PredictionOutputs
    expect(Object.keys(v2Outputs).length).toBe(8)
    expect(v2Outputs.prott5_secondary_structure).toBeDefined()
    expect(typeof v2Outputs.tmbed).toBe('object')
    expect(v2Outputs.tmbed?.labels).toMatch(/^[BbHhSio]+$/)
    expect(v2Outputs.tmbed?.probabilities).toBeInstanceOf(Array)
    expect(v2Outputs.bindembed?.metal).toMatch(/^[b\-]+$/)
    expect(v2Outputs.bindembed?.nucleicAcids).toMatch(/^[b\-]+$/)
    expect(v2Outputs.bindembed?.smallMolecules).toMatch(/^[b\-]+$/)
    expect(v2Outputs.seth).toBeInstanceOf(Array)
    expect(v2Outputs.prott5_conservation).toBeInstanceOf(Array)
    expect(v2Outputs.variation).toBeDefined()
    expect(v2Outputs.light_attention_subcellular).toBeDefined()
    expect(v2Outputs.light_attention_membrane).toBeDefined()
  })

  it('partial failure: vespag ShapeError → modelErrors.variation = SHAPE_MISMATCH, outputs has 7 keys', async () => {
    const store = makeInMemoryStore(
      new Map([[embeddingRefKey(EMB_MODEL, SEQ_HASH), EMB_FP16]]),
    )
    const outputs: PredictionOutputs = {
      prott5_secondary_structure: {
        dssp3: 'C'.repeat(SEQ.length),
        dssp8: 'C'.repeat(SEQ.length),
      },
      tmbed: {
        labels: 'i'.repeat(SEQ.length),
        probabilities: [],
      },
      seth: new Array(SEQ.length).fill(0.1),
      bindembed: {
        metal: '-'.repeat(SEQ.length),
        nucleicAcids: '-'.repeat(SEQ.length),
        smallMolecules: '-'.repeat(SEQ.length),
      },
      prott5_conservation: new Array(SEQ.length).fill(5),
      light_attention_subcellular: 'Cytoplasm',
      light_attention_membrane: 'Not-Membrane',
      // variation deliberately absent → vespag failed
    }
    const modelErrors: ModelErrors = {
      variation: {
        code: 'SHAPE_MISMATCH',
        message: 'vespag: mocked failure',
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

    const raw = await store.get(result.predictionRef)
    const parsed = StoredPredictionSchema.safeParse(
      JSON.parse(raw.toString('utf8')),
    )
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const stored = parsed.data
    expect(stored.schemaVersion).toBe(2)
    const v2Outputs = stored.outputs as PredictionOutputs
    expect(v2Outputs.variation).toBeUndefined()
    expect(Object.keys(v2Outputs).length).toBe(7)

    const storedV2 = stored as Extract<typeof stored, { schemaVersion: 2 }>
    const errors = storedV2.modelErrors as ModelErrors | undefined
    expect(errors?.variation?.code).toBe('SHAPE_MISMATCH')
    expect(errors?.variation?.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
