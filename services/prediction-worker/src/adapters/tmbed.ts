import {
  readFp32Output,
  readBytesTensor,
  readInferOutputBuffer,
} from '@protifer/triton-client'

import { ShapeError, DecodeError } from './errors.ts'
import type { ModelAdapter } from './types.ts'

// TMbed CV model output: 5 classes per residue [B, H, S, i, o].
// Post-Viterbi ensemble output: probabilities shape [seqLen, 5].
const N_TMBED_CLASSES = 5

export const tmbedAdapter: ModelAdapter<'tmbed'> = {
  modelName: 'tmbed',
  outputKey: 'tmbed',

  buildRequest({ embeddingFp32, mask, seqLen }) {
    const embBuf = Buffer.from(
      embeddingFp32.buffer,
      embeddingFp32.byteOffset,
      embeddingFp32.byteLength,
    )
    const maskBuf = Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength)
    return {
      model_name: 'tmbed',
      inputs: [
        { name: 'ensemble_input', datatype: 'FP32', shape: [1, seqLen, 1024] },
        { name: 'mask', datatype: 'FP32', shape: [1, seqLen] },
      ],
      outputs: [{ name: 'labels' }, { name: 'probabilities' }],
      raw_input_contents: [embBuf, maskBuf],
    }
  },

  decodeResponse(response) {
    // labels: BYTES output[0], expected exactly 1 string entry.
    const labelsBuf = readInferOutputBuffer(response, 0)
    if (labelsBuf.length === 0) {
      throw new ShapeError('tmbed: empty labels output')
    }
    const entries = readBytesTensor(labelsBuf)
    if (entries.length !== 1) {
      throw new DecodeError(
        `tmbed: expected exactly 1 labels string, got ${String(entries.length)}`,
      )
    }
    const firstEntry = entries[0]
    if (firstEntry === undefined) {
      throw new DecodeError('tmbed: labels entry is undefined')
    }
    const labels = firstEntry.toString('utf8')

    // probabilities: FP32 output[1], shape [seqLen, 5] row-major.
    const probFlat = readFp32Output(response, 1)
    if (probFlat.length % N_TMBED_CLASSES !== 0) {
      throw new ShapeError(
        `tmbed: probabilities length ${String(probFlat.length)} not divisible by ${String(N_TMBED_CLASSES)}`,
      )
    }
    const seqLen = probFlat.length / N_TMBED_CLASSES
    const probabilities: number[][] = Array.from({ length: seqLen }, () =>
      Array.from({ length: N_TMBED_CLASSES }, () => 0),
    )
    for (let r = 0; r < seqLen; r++) {
      const row = probabilities[r]
      if (row === undefined) continue
      for (let c = 0; c < N_TMBED_CLASSES; c++) {
        row[c] = probFlat[r * N_TMBED_CLASSES + c] ?? 0
      }
    }

    return { labels, probabilities }
  },
}
