import type {
  EmbeddingJobData,
  EmbeddingJobResult,
  Job,
  ObjectStore,
} from '@protifer/shared'
import { embeddingRefKey } from '@protifer/shared'
import {
  DEFAULT_DEADLINE_MS,
  fp32ArrayToFp16Buffer,
} from '@protifer/triton-client'
import type { TritonClient } from '@protifer/triton-client'

interface ProcessorDeps {
  triton: TritonClient
  store: ObjectStore
  /** gRPC deadline for Triton modelInfer calls (ms). Defaults to DEFAULT_DEADLINE_MS. */
  deadlineMs?: number
}

export async function processEmbeddingJob(
  job: Job,
  deps: ProcessorDeps,
): Promise<EmbeddingJobResult> {
  const { sequence, sequenceHash, embeddingModel } =
    job.data as EmbeddingJobData
  const { triton, store, deadlineMs = DEFAULT_DEADLINE_MS } = deps

  const embeddingRef = embeddingRefKey(embeddingModel, sequenceHash)
  if (await store.exists(embeddingRef)) {
    await job.log(`Cache hit: reusing stored embedding at ${embeddingRef}`)
    return { embeddingRef, computedAt: new Date().toISOString() }
  }

  await job.updateProgress(10)

  const response = await triton.modelInfer(
    {
      model_name: 'prot_t5_pipeline',
      inputs: [
        {
          name: 'sequences',
          datatype: 'BYTES',
          // prot_t5_pipeline has max_batch_size > 0, so Triton requires a
          // leading batch dim: [batch=1, one sequence]. A 1-D [1] is rejected.
          shape: [1, 1],
          contents: { bytes_contents: [Buffer.from(sequence, 'utf8')] },
        },
      ],
      outputs: [{ name: 'embeddings' }],
    },
    { deadlineMs },
  )

  await job.updateProgress(70)

  const output = response.outputs[0]
  if (!output)
    throw new Error('Triton returned no output tensor for prot_t5_pipeline')

  // Primary path: FP16 raw bytes directly off the wire → Garage.
  let fp16Buf: Buffer = response.raw_output_contents[0] ?? Buffer.alloc(0)

  // Fallback for a misconfigured server that emits fp32 instead of raw bytes.
  if (fp16Buf.length === 0 && output.contents.fp32_contents.length > 0) {
    fp16Buf = fp32ArrayToFp16Buffer(output.contents.fp32_contents)
  }

  if (fp16Buf.length === 0 || fp16Buf.length % 2 !== 0) {
    throw new Error(
      `prot_t5_pipeline: invalid FP16 output length ${String(fp16Buf.length)}`,
    )
  }

  await store.put(embeddingRef, fp16Buf)

  const computedAt = new Date().toISOString()
  await job.updateProgress(100)
  await job.log(
    `Stored embedding at ${embeddingRef} (${String(fp16Buf.length)} FP16 bytes)`,
  )

  return { embeddingRef, computedAt }
}
