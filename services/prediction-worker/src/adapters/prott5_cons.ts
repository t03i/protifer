import { readFp32Output } from '@protifer/triton-client'

import { ShapeError } from './errors.ts'
import { argmaxSlice, outputIndexByName } from './tensor-io.ts'
import type { ModelAdapter } from './types.ts'

const N_CONS_CLASSES = 9

export const prott5ConsAdapter: ModelAdapter<'prott5_conservation'> = {
  modelName: 'prott5_cons',
  outputKey: 'prott5_conservation',

  buildRequest({ embeddingFp32, seqLen }) {
    const buf = Buffer.from(
      embeddingFp32.buffer,
      embeddingFp32.byteOffset,
      embeddingFp32.byteLength,
    )
    return {
      model_name: 'prott5_cons',
      inputs: [{ name: 'input', datatype: 'FP32', shape: [1, seqLen, 1024] }],
      outputs: [{ name: 'output' }],
      raw_input_contents: [buf],
    }
  },

  decodeResponse(response) {
    const flat = readFp32Output(response, outputIndexByName(response, 'output'))
    // Guard empty BEFORE the modulo: 0 % 9 === 0 would otherwise pass a
    // missing/empty output through as a valid seqLen=0 prediction (no error,
    // no log) instead of surfacing the failure. Matches seth/vespag.
    if (flat.length === 0) {
      throw new ShapeError('prott5_cons: empty output')
    }
    if (flat.length % N_CONS_CLASSES !== 0) {
      throw new ShapeError(
        `prott5_cons: length ${String(flat.length)} not divisible by ${String(N_CONS_CLASSES)}`,
      )
    }
    const seqLen = flat.length / N_CONS_CLASSES
    const out: number[] = Array.from({ length: seqLen }, () => 0)
    for (let r = 0; r < seqLen; r++) {
      out[r] = argmaxSlice(flat, r * N_CONS_CLASSES, N_CONS_CLASSES)
    }
    return out
  },
}
