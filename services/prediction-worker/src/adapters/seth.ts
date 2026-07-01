import { readFp32Output } from '@protifer/triton-client'

import { ShapeError } from './errors.ts'
import { outputIndexByName } from './tensor-io.ts'
import type { ModelAdapter } from './types.ts'

export const sethAdapter: ModelAdapter<'seth'> = {
  modelName: 'seth',
  outputKey: 'seth',

  buildRequest({ embeddingFp32, seqLen }) {
    const buf = Buffer.from(
      embeddingFp32.buffer,
      embeddingFp32.byteOffset,
      embeddingFp32.byteLength,
    )
    return {
      model_name: 'seth',
      inputs: [{ name: 'input', datatype: 'FP32', shape: [1, seqLen, 1024] }],
      outputs: [{ name: 'output' }],
      raw_input_contents: [buf],
    }
  },

  decodeResponse(response) {
    const flat = readFp32Output(response, outputIndexByName(response, 'output'))
    if (flat.length === 0) {
      throw new ShapeError('seth: empty output')
    }
    // SETH output is [seqLen, 1] — flatten to number[] of length seqLen.
    return Array.from(flat)
  },
}
