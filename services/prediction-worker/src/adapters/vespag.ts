import { readFp32Output, AMINO_ACIDS } from '@protifer/triton-client'

import { ShapeError } from './errors.ts'
import type { ModelAdapter } from './types.ts'

export const vespagAdapter: ModelAdapter<'variation'> = {
  modelName: 'vespag',
  outputKey: 'variation',

  buildRequest({ embeddingFp32, seqLen }) {
    const buf = Buffer.from(
      embeddingFp32.buffer,
      embeddingFp32.byteOffset,
      embeddingFp32.byteLength,
    )
    return {
      model_name: 'vespag',
      inputs: [{ name: 'input', datatype: 'FP32', shape: [1, seqLen, 1024] }],
      outputs: [{ name: 'output' }],
      raw_input_contents: [buf],
    }
  },

  decodeResponse(response) {
    const flat = readFp32Output(response, 0)
    if (flat.length === 0) {
      throw new ShapeError('vespag: empty output')
    }
    const N_AA = AMINO_ACIDS.length
    if (flat.length % N_AA !== 0) {
      throw new ShapeError(
        `vespag: output length ${String(flat.length)} not divisible by ${String(N_AA)}`,
      )
    }
    const seqLen = flat.length / N_AA
    // Build values as [N_AA][seqLen] row-major: each row = per-residue scores for one amino acid.
    // Field name is `values` per VariationOutputSchema in packages/shared/src/types.ts.
    const values: number[][] = Array.from({ length: N_AA }, () =>
      Array.from({ length: seqLen }, () => 0),
    )
    for (let aa = 0; aa < N_AA; aa++) {
      const row = values[aa]
      if (row === undefined) continue
      for (let r = 0; r < seqLen; r++) {
        row[r] = flat[r * N_AA + aa] ?? 0
      }
    }
    return {
      x_axis: Array.from({ length: seqLen }, (_, i) => String(i + 1)),
      y_axis: [...AMINO_ACIDS],
      values,
    }
  },
}
