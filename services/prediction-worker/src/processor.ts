import type {
  EmbeddingJobResult,
  Job,
  ObjectStore,
  PredictionJobData,
  PredictionJobResult,
  StoredPredictionV2,
} from '@protifer/shared'
import { predictionRefKey } from '@protifer/shared'
import {
  DEFAULT_DEADLINE_MS,
  fp16BufferToFp32Array,
} from '@protifer/triton-client'
import type { TritonClient } from '@protifer/triton-client'

import type { AdapterContext } from './adapters/types.ts'
import { dispatchAll } from './dispatch.ts'

interface ProcessorDeps {
  triton: TritonClient
  store: ObjectStore
  /** gRPC deadline for Triton modelInfer calls (ms). Defaults to DEFAULT_DEADLINE_MS. */
  deadlineMs?: number
}

export async function processPredictionJob(
  job: Job,
  deps: ProcessorDeps,
): Promise<PredictionJobResult> {
  const { sequence, sequenceHash, embeddingModel, predictionModels } =
    job.data as PredictionJobData
  const { triton, store, deadlineMs = DEFAULT_DEADLINE_MS } = deps

  await job.updateProgress(10)

  const childrenValues = (await job.getChildrenValues()) as Record<
    string,
    EmbeddingJobResult
  >
  const embeddingResult = Object.values(childrenValues)[0]
  if (!embeddingResult?.embeddingRef) {
    throw new Error(
      'Embedding child job result missing — cannot retrieve embeddingRef',
    )
  }
  const { embeddingRef } = embeddingResult

  const embBuf = await store.get(embeddingRef)

  // Embedding is FP16 on-disk; up-convert once to FP32 for adapter fan-out.
  if (embBuf.length % 2 !== 0) {
    throw new Error(
      `embedding buffer length ${String(embBuf.length)} is not valid FP16 (must be even)`,
    )
  }
  if ((embBuf.length / 2) % 1024 !== 0) {
    throw new Error(
      `embedding buffer length ${String(embBuf.length)} does not match [seqLen, 1024] FP16 shape`,
    )
  }
  const seqLen = embBuf.length / (1024 * 2)
  const embeddingFp32 = fp16BufferToFp32Array(embBuf)
  const mask = new Float32Array(seqLen).fill(1.0)

  await job.updateProgress(30)

  const ctx: AdapterContext = { embeddingFp32, mask, seqLen, sequence }
  const { outputs, modelErrors } = await dispatchAll(triton, ctx, {
    deadlineMs,
  })

  await job.updateProgress(80)

  if (Object.keys(outputs).length === 0) {
    const summary = Object.entries(modelErrors)
      .map(([model, entry]) => `${model}(${entry.code}): ${entry.message}`)
      .join(' | ')
    throw new Error(`All prediction models failed — ${summary}`)
  }

  const stored: StoredPredictionV2 = {
    schemaVersion: 2,
    versions: predictionModels,
    outputs,
    ...(Object.keys(modelErrors).length > 0 ? { modelErrors } : {}),
  }

  const predictionRef = predictionRefKey(
    embeddingModel,
    predictionModels,
    sequenceHash,
  )
  await store.put(
    predictionRef,
    Buffer.from(JSON.stringify(stored), 'utf8'),
    'application/json',
  )

  const computedAt = new Date().toISOString()
  await job.updateProgress(100)
  await job.log(`Stored prediction at ${predictionRef}`)

  return { predictionRef, computedAt }
}
