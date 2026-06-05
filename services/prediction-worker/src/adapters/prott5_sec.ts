import {
  readFp32Output,
  DSSP3_LABELS,
  DSSP8_LABELS,
} from '@protifer/triton-client'

import { ShapeError } from './errors.ts'
import { argmaxSlice } from './tensor-io.ts'
import type { ModelAdapter } from './types.ts'

export const prott5SecAdapter: ModelAdapter<'prott5_secondary_structure'> = {
  modelName: 'prott5_sec',
  outputKey: 'prott5_secondary_structure',

  buildRequest({ embeddingFp32, seqLen }) {
    const buf = Buffer.from(
      embeddingFp32.buffer,
      embeddingFp32.byteOffset,
      embeddingFp32.byteLength,
    )
    return {
      model_name: 'prott5_sec',
      inputs: [{ name: 'input', datatype: 'FP32', shape: [seqLen, 1024] }],
      outputs: [{ name: 'd3_Yhat' }, { name: 'd8_Yhat' }],
      raw_input_contents: [buf],
    }
  },

  decodeResponse(response) {
    const d3Flat = readFp32Output(response, 0)
    if (d3Flat.length === 0) {
      throw new ShapeError('prott5_sec: d3_Yhat output is empty or missing')
    }
    if (d3Flat.length % DSSP3_LABELS.length !== 0) {
      throw new ShapeError(
        `prott5_sec: d3_Yhat length ${String(d3Flat.length)} not divisible by ${String(DSSP3_LABELS.length)}`,
      )
    }
    const seqLen = d3Flat.length / DSSP3_LABELS.length

    const d8Flat = readFp32Output(response, 1)
    if (d8Flat.length === 0) {
      throw new ShapeError('prott5_sec: d8_Yhat output is empty or missing')
    }
    if (d8Flat.length % DSSP8_LABELS.length !== 0) {
      throw new ShapeError(
        `prott5_sec: d8_Yhat length ${String(d8Flat.length)} not divisible by ${String(DSSP8_LABELS.length)}`,
      )
    }

    let dssp3 = ''
    for (let r = 0; r < seqLen; r++) {
      const maxIdx = argmaxSlice(
        d3Flat,
        r * DSSP3_LABELS.length,
        DSSP3_LABELS.length,
      )
      dssp3 += DSSP3_LABELS[maxIdx] ?? ''
    }

    let dssp8 = ''
    for (let r = 0; r < seqLen; r++) {
      const maxIdx = argmaxSlice(
        d8Flat,
        r * DSSP8_LABELS.length,
        DSSP8_LABELS.length,
      )
      dssp8 += DSSP8_LABELS[maxIdx] ?? ''
    }

    return { dssp3, dssp8 }
  },
}
