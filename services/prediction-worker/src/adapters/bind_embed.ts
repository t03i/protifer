import { readFp32Output } from '@protifer/triton-client'

import { ShapeError } from './errors.ts'
import type { ModelAdapter } from './types.ts'

// Values pinned to bindEmbed21DL commit c9b12e7 (Rostlab/bindPredict, master).
const BIND_THRESHOLD = 0.5 // bindEmbed21DL default (ProteinResults.__init__ bind_cutoff=0.5)
const NUM_CVS = 5
const NUM_CHANNELS = 3 // [metal=0, nucleicAcids=1, smallMolecules=2] per data_preparation.py:136-143

export const bindEmbedAdapter: ModelAdapter<'bindembed'> = {
  modelName: 'bind_embed',
  outputKey: 'bindembed',

  buildRequest({ embeddingFp32, seqLen }) {
    // Transpose [seqLen, 1024] → [1024, seqLen]: bind_embed's required layout.
    // Indexing: transposed[c * seqLen + r] = embeddingFp32[r * 1024 + c]
    // (NOT buf[c * 1024 + r] — per RESEARCH.md Pitfall 2)
    const transposed = new Float32Array(1024 * seqLen)
    for (let r = 0; r < seqLen; r++) {
      for (let c = 0; c < 1024; c++) {
        transposed[c * seqLen + r] = embeddingFp32[r * 1024 + c] ?? 0
      }
    }
    const buf = Buffer.from(
      transposed.buffer,
      transposed.byteOffset,
      transposed.byteLength,
    )
    return {
      model_name: 'bind_embed',
      inputs: [
        { name: 'ensemble_input', datatype: 'FP32', shape: [1024, seqLen] },
      ],
      outputs: [
        { name: 'output_0' },
        { name: 'output_1' },
        { name: 'output_2' },
        { name: 'output_3' },
        { name: 'output_4' },
      ],
      raw_input_contents: [buf],
    }
  },

  decodeResponse(response) {
    const outputsLen = response.outputs.length
    if (outputsLen < NUM_CVS) {
      throw new ShapeError(
        `bind_embed: expected ${String(NUM_CVS)} outputs, got ${String(outputsLen)}`,
      )
    }

    const cvs: Float32Array[] = []
    for (let i = 0; i < NUM_CVS; i++) {
      const cv = readFp32Output(response, i)
      if (cv.length === 0 || cv.length % NUM_CHANNELS !== 0) {
        throw new ShapeError(
          `bind_embed cv${String(i)}: length ${String(cv.length)} not divisible by ${String(NUM_CHANNELS)}`,
        )
      }
      cvs.push(cv)
    }

    const firstCv = cvs[0]
    if (firstCv === undefined) {
      throw new ShapeError('bind_embed: no CV outputs decoded')
    }
    const seqLen = firstCv.length / NUM_CHANNELS
    for (let i = 1; i < NUM_CVS; i++) {
      const cv = cvs[i]
      if (cv === undefined || cv.length !== seqLen * NUM_CHANNELS) {
        throw new ShapeError(
          `bind_embed cv${String(i)} length mismatch with cv0`,
        )
      }
    }

    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

    // Per RESEARCH.md §1 (bindEmbed21DL c9b12e7):
    // For each residue r, channel c: p = Σ_{i=0..4} sigmoid(cv_i[r,c]) / 5
    // if p >= BIND_THRESHOLD → 'b', else '-'
    let metal = ''
    let nucleicAcids = ''
    let smallMolecules = ''

    for (let r = 0; r < seqLen; r++) {
      for (let c = 0; c < NUM_CHANNELS; c++) {
        let sum = 0
        for (let k = 0; k < NUM_CVS; k++) {
          sum += sigmoid(cvs[k]?.[r * NUM_CHANNELS + c] ?? 0)
        }
        const p = sum / NUM_CVS
        const letter = p >= BIND_THRESHOLD ? 'b' : '-'
        if (c === 0) metal += letter
        else if (c === 1) nucleicAcids += letter
        else smallMolecules += letter
      }
    }

    return { metal, nucleicAcids, smallMolecules }
  },
}
