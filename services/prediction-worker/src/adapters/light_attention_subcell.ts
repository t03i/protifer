import { readFp32Output } from '@protifer/triton-client'

import { ShapeError } from './errors.ts'
import { argmaxSlice } from './tensor-io.ts'
import type { ModelAdapter } from './types.ts'

// From HannesStark/protein-localization commit 7b0be1e utils/general.py LOCALIZATION array.
export const SUBCELL_LABELS = [
  'Cell.membrane',
  'Cytoplasm',
  'Endoplasmic.reticulum',
  'Golgi.apparatus',
  'Lysosome/Vacuole',
  'Mitochondrion',
  'Nucleus',
  'Peroxisome',
  'Plastid',
  'Extracellular',
] as const

export const lightAttentionSubcellAdapter: ModelAdapter<'light_attention_subcellular'> =
  {
    modelName: 'light_attention_subcell',
    outputKey: 'light_attention_subcellular',

    buildRequest({ embeddingFp32, mask, seqLen }) {
      const embBuf = Buffer.from(
        embeddingFp32.buffer,
        embeddingFp32.byteOffset,
        embeddingFp32.byteLength,
      )
      const maskBuf = Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength)
      return {
        model_name: 'light_attention_subcell',
        inputs: [
          { name: 'input', datatype: 'FP32', shape: [1, seqLen, 1024] },
          { name: 'mask', datatype: 'FP32', shape: [1, seqLen] },
        ],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf, maskBuf],
      }
    },

    decodeResponse(response) {
      const flat = readFp32Output(response, 0)
      if (flat.length !== SUBCELL_LABELS.length) {
        throw new ShapeError(
          `light_attention_subcell: expected ${String(SUBCELL_LABELS.length)} floats, got ${String(flat.length)}`,
        )
      }
      const maxIdx = argmaxSlice(flat, 0, flat.length)
      const label = SUBCELL_LABELS[maxIdx]
      if (label === undefined) {
        throw new ShapeError(
          'light_attention_subcell: argmax index out of range',
        )
      }
      // Dot-form → space-form sanitisation per RESEARCH.md §5.
      return label.replaceAll('.', ' ')
    },
  }
