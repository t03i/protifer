import type {
  EmbeddingJobData,
  EmbeddingModelConfig,
  Job,
} from '@protifer/shared'
import {
  computeSequenceHash,
  createWorkerMetrics,
  embeddingRefKey,
  makeInMemoryStore,
} from '@protifer/shared'
import type { TritonClient } from '@protifer/triton-client'
import { fp32ArrayToFp16Buffer } from '@protifer/triton-client'
import { describe, it, expect, vi } from 'vitest'

import { processEmbeddingJob } from './processor.ts'

const EMB_MODEL: EmbeddingModelConfig = { name: 'prott5_xl_u50', version: 'v1' }

function makeJob(sequence: string): Job {
  return {
    data: {
      sequence,
      sequenceHash: computeSequenceHash(sequence),
      embeddingModel: EMB_MODEL,
      userId: 'u1',
      submittedAt: new Date().toISOString(),
    } satisfies EmbeddingJobData,
    log: vi.fn(),
    updateProgress: vi.fn(),
  } as unknown as Job
}

function makeTritonRaw(fp16Buf: Buffer): {
  client: TritonClient
  modelInferMock: ReturnType<typeof vi.fn>
} {
  const modelInferMock = vi.fn().mockResolvedValue({
    model_name: 'prot_t5_pipeline',
    outputs: [
      {
        name: 'embeddings',
        datatype: 'FP16',
        shape: [fp16Buf.length / (1024 * 2), 1024],
        contents: {
          fp32_contents: [],
          bytes_contents: [],
          int64_contents: [],
        },
      },
    ],
    raw_output_contents: [fp16Buf],
  })
  return {
    client: {
      modelInfer: modelInferMock,
      modelReady: vi.fn().mockResolvedValue(true),
      serverReady: vi.fn(),
      close: vi.fn(),
    },
    modelInferMock,
  }
}

function makeTritonFp32Fallback(fp32: number[]): {
  client: TritonClient
  modelInferMock: ReturnType<typeof vi.fn>
} {
  const modelInferMock = vi.fn().mockResolvedValue({
    model_name: 'prot_t5_pipeline',
    outputs: [
      {
        name: 'embeddings',
        datatype: 'FP16',
        shape: [fp32.length / 1024, 1024],
        contents: {
          fp32_contents: fp32,
          bytes_contents: [],
          int64_contents: [],
        },
      },
    ],
    raw_output_contents: [],
  })
  return {
    client: {
      modelInfer: modelInferMock,
      modelReady: vi.fn().mockResolvedValue(true),
      serverReady: vi.fn(),
      close: vi.fn(),
    },
    modelInferMock,
  }
}

// Real-Triton-shaped mock: rejects a non-numeric model_version on the wire.
function makeStrictTriton(fp16Buf: Buffer): {
  client: TritonClient
  modelInferMock: ReturnType<typeof vi.fn>
} {
  const modelInferMock = vi.fn((req: { model_version?: string }) => {
    if (req.model_version !== undefined && !/^\d+$/.test(req.model_version)) {
      throw new Error('model_version must be numeric')
    }
    return Promise.resolve({
      model_name: 'prot_t5_pipeline',
      outputs: [
        {
          name: 'embeddings',
          datatype: 'FP16',
          shape: [fp16Buf.length / (1024 * 2), 1024],
          contents: {
            fp32_contents: [],
            bytes_contents: [],
            int64_contents: [],
          },
        },
      ],
      raw_output_contents: [fp16Buf],
    })
  })
  return {
    client: {
      modelInfer: modelInferMock,
      modelReady: vi.fn().mockResolvedValue(true),
      serverReady: vi.fn(),
      close: vi.fn(),
    } as unknown as TritonClient,
    modelInferMock,
  }
}

describe('processEmbeddingJob', () => {
  it('returns cached embeddingRef immediately if already stored (no Triton call)', async () => {
    const sequence = 'ACDE'
    const embRef = embeddingRefKey(EMB_MODEL, computeSequenceHash(sequence))
    const store = makeInMemoryStore(
      new Map([[embRef, Buffer.alloc(4 * 1024 * 2)]]),
    )
    const { client: triton, modelInferMock } = makeTritonRaw(
      Buffer.alloc(4 * 1024 * 2),
    )

    const result = await processEmbeddingJob(makeJob(sequence), {
      store,
      triton,
    })

    expect(result.embeddingRef).toBe(embRef)
    expect(modelInferMock).not.toHaveBeenCalled()
  })

  it('calls prot_t5_pipeline with BYTES sequences input and stores FP16 bytes from raw_output_contents', async () => {
    const sequence = 'MKTVRQERLK'
    const seqLen = sequence.length
    const store = makeInMemoryStore()
    const fp32 = new Array(seqLen * 1024).fill(0.1) as number[]
    const fp16Buf = fp32ArrayToFp16Buffer(fp32)
    const { client: triton, modelInferMock } = makeTritonRaw(fp16Buf)

    const result = await processEmbeddingJob(makeJob(sequence), {
      store,
      triton,
    })

    expect(result.embeddingRef).toBe(
      embeddingRefKey(EMB_MODEL, computeSequenceHash(sequence)),
    )
    expect(result.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(modelInferMock).toHaveBeenCalledOnce()
    const request = modelInferMock.mock.calls.at(0)?.[0] as {
      model_name: string
      model_version?: string
      inputs: { name: string; datatype: string; shape: number[] }[]
      outputs: { name: string }[]
    }
    expect(request.model_name).toBe('prot_t5_pipeline')
    expect(request.model_version).toBeUndefined()
    expect(request.inputs.at(0)?.name).toBe('sequences')
    expect(request.inputs.at(0)?.datatype).toBe('BYTES')
    expect(request.inputs.at(0)?.shape).toEqual([1, 1])
    expect(request.outputs.at(0)?.name).toBe('embeddings')
    const stored = await store.get(result.embeddingRef)
    expect(stored.length).toBe(seqLen * 1024 * 2)
  })

  it('falls back to fp32_contents when raw_output_contents is empty and re-packs as FP16 bytes', async () => {
    const sequence = 'MKTVRQERLK'
    const seqLen = sequence.length
    const store = makeInMemoryStore()
    const fp32 = new Array(seqLen * 1024).fill(0.25) as number[]
    const { client: triton } = makeTritonFp32Fallback(fp32)

    const result = await processEmbeddingJob(makeJob(sequence), {
      store,
      triton,
    })

    const stored = await store.get(result.embeddingRef)
    expect(stored.length).toBe(seqLen * 1024 * 2)
  })

  it('throws when both raw_output_contents and fp32_contents are empty', async () => {
    const sequence = 'MKTVRQERLK'
    const store = makeInMemoryStore()
    const { client: triton } = makeTritonFp32Fallback([])

    await expect(
      processEmbeddingJob(makeJob(sequence), { store, triton }),
    ).rejects.toThrow(/invalid FP16 output length/)
  })

  it('stores when the embedding row count equals the sequence length', async () => {
    const sequence = 'MKTVRQERLK'
    const store = makeInMemoryStore()
    const fp16Buf = fp32ArrayToFp16Buffer(
      new Array(sequence.length * 1024).fill(0.1) as number[],
    )
    const { client: triton } = makeTritonRaw(fp16Buf)

    const result = await processEmbeddingJob(makeJob(sequence), {
      store,
      triton,
    })

    const stored = await store.get(result.embeddingRef)
    expect(stored.length).toBe(sequence.length * 1024 * 2)
  })

  it('throws when the embedding has an extra (EOS) row beyond the sequence length', async () => {
    const sequence = 'MKTVRQERLK'
    const store = makeInMemoryStore()
    const fp16Buf = fp32ArrayToFp16Buffer(
      new Array((sequence.length + 1) * 1024).fill(0.1) as number[],
    )
    const { client: triton } = makeTritonRaw(fp16Buf)

    await expect(
      processEmbeddingJob(makeJob(sequence), { store, triton }),
    ).rejects.toThrow(/row count .* != sequence length/)
  })

  it('succeeds against a strict Triton mock that rejects non-numeric model_version', async () => {
    const sequence = 'MKTVRQERLK'
    const seqLen = sequence.length
    const store = makeInMemoryStore()
    const fp32 = new Array(seqLen * 1024).fill(0.1) as number[]
    const fp16Buf = fp32ArrayToFp16Buffer(fp32)
    const { client: triton, modelInferMock } = makeStrictTriton(fp16Buf)

    const result = await processEmbeddingJob(makeJob(sequence), {
      store,
      triton,
    })

    expect(modelInferMock).toHaveBeenCalledOnce()
    const stored = await store.get(result.embeddingRef)
    expect(stored.length).toBe(seqLen * 1024 * 2)
  })

  it('records success metrics for triton infer and the job on the happy path', async () => {
    const sequence = 'MKTVRQERLK'
    const store = makeInMemoryStore()
    const fp16Buf = fp32ArrayToFp16Buffer(
      new Array(sequence.length * 1024).fill(0.1) as number[],
    )
    const { client: triton } = makeTritonRaw(fp16Buf)
    const metrics = createWorkerMetrics()

    await processEmbeddingJob(makeJob(sequence), { store, triton, metrics })

    const text = await metrics.registry.metrics()
    expect(text).toMatch(
      /triton_model_infer_duration_seconds_count\{[^}]*status="success"[^}]*\} 1/,
    )
    expect(text).toContain(
      'embedding_job_duration_seconds_count{status="success"} 1',
    )
  })

  it('records the triton failure status and a failed job when modelInfer throws', async () => {
    const sequence = 'MKTVRQERLK'
    const store = makeInMemoryStore()
    const triton = {
      modelInfer: vi.fn().mockRejectedValue({ code: 14 }),
      modelReady: vi.fn().mockResolvedValue(true),
      serverReady: vi.fn(),
      close: vi.fn(),
    } as unknown as TritonClient
    const metrics = createWorkerMetrics()

    await expect(
      processEmbeddingJob(makeJob(sequence), { store, triton, metrics }),
    ).rejects.toBeDefined()

    const text = await metrics.registry.metrics()
    expect(text).toMatch(
      /triton_model_infer_duration_seconds_count\{[^}]*status="UNAVAILABLE"[^}]*\} 1/,
    )
    expect(text).toContain(
      'embedding_job_duration_seconds_count{status="failure"} 1',
    )
  })
})
