import type { InferResponse } from '@protifer/triton-client'

import { DecodeError } from './errors.ts'

const EMBED_DIM = 1024

/**
 * Resolve the index of a named output in a Triton response. Triton does not
 * guarantee outputs come back in requested/config order (notably ensembles —
 * tmbed returned them reversed), so adapters must decode by name, never by a
 * hardcoded position. `raw_output_contents` is parallel to `response.outputs`,
 * so the returned index is valid for both the raw buffers and the contents
 * fallback. Throws DecodeError if the named output is absent.
 */
export function outputIndexByName(
  response: InferResponse,
  name: string,
): number {
  const idx = response.outputs.findIndex((o) => o.name === name)
  if (idx === -1) {
    throw new DecodeError(
      `${response.model_name}: response missing '${name}' output`,
    )
  }
  return idx
}

/**
 * Transpose a row-major [seqLen, 1024] embedding into channels-first
 * [1024, seqLen] layout and return it as a raw FP32 Buffer.
 *
 * Conv1d-based models (LightAttention, bind_embed) take input as
 * [batch, embeddings_dim=1024, sequence_length]; the worker holds embeddings
 * as [seqLen, 1024], so adapters for those models must transpose. Sending
 * channels-last makes Triton's first Conv read seqLen as the channel dim
 * (`C: <seqLen> kernel channels: 1024`). Indexing mirrors bind_embed:
 * transposed[c * seqLen + r] = embeddingFp32[r * 1024 + c].
 */
export function channelsFirstEmbeddingBuffer(
  embeddingFp32: Float32Array,
  seqLen: number,
): Buffer {
  const transposed = new Float32Array(EMBED_DIM * seqLen)
  for (let r = 0; r < seqLen; r++) {
    for (let c = 0; c < EMBED_DIM; c++) {
      transposed[c * seqLen + r] = embeddingFp32[r * EMBED_DIM + c] ?? 0
    }
  }
  return Buffer.from(
    transposed.buffer,
    transposed.byteOffset,
    transposed.byteLength,
  )
}

/**
 * Index of the maximum value in the `nClasses`-wide slice of `flat` starting at
 * `offset` (i.e. argmax over `flat[offset .. offset + nClasses)`). Missing
 * entries are treated as `-Infinity`. Shared by the classification adapters.
 */
export function argmaxSlice(
  flat: ArrayLike<number>,
  offset: number,
  nClasses: number,
): number {
  let maxIdx = 0
  let maxVal = flat[offset] ?? -Infinity
  for (let c = 1; c < nClasses; c++) {
    const v = flat[offset + c] ?? -Infinity
    if (v > maxVal) {
      maxVal = v
      maxIdx = c
    }
  }
  return maxIdx
}
