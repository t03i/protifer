import { readFp32Output } from '@protifer/triton-client'

import { ShapeError } from './errors.ts'
import { argmaxSlice, channelsFirstEmbeddingBuffer } from './tensor-io.ts'
import type { ModelAdapter } from './types.ts'

// From HannesStark/protein-localization commit 7b0be1e utils/general.py:
//   SOLUBILITY = ['M', 'S', 'U'] — 'U' is a training-only sentinel, not an output class.
// ONNX output dim [2] → two classes, order [M=index 0, S=index 1].
export const MEMBRANE_LABELS = [
  'Membrane bound', // index 0 — class 'M'
  'Soluble', // index 1 — class 'S'
] as const

export const lightAttentionMembraneAdapter: ModelAdapter<'light_attention_membrane'> =
  {
    modelName: 'light_attention_membrane',
    outputKey: 'light_attention_membrane',

    buildRequest({ embeddingFp32, mask, seqLen }) {
      // LightAttention Conv1d expects channels-first [1, 1024, seqLen].
      const embBuf = channelsFirstEmbeddingBuffer(embeddingFp32, seqLen)
      const maskBuf = Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength)
      return {
        model_name: 'light_attention_membrane',
        inputs: [
          { name: 'input', datatype: 'FP32', shape: [1, 1024, seqLen] },
          { name: 'mask', datatype: 'FP32', shape: [1, seqLen] },
        ],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf, maskBuf],
      }
    },

    decodeResponse(response) {
      const flat = readFp32Output(response, 0)
      if (flat.length !== MEMBRANE_LABELS.length) {
        throw new ShapeError(
          `light_attention_membrane: expected ${String(MEMBRANE_LABELS.length)} floats, got ${String(flat.length)}`,
        )
      }
      const maxIdx = argmaxSlice(flat, 0, flat.length)
      const label = MEMBRANE_LABELS[maxIdx]
      if (label === undefined) {
        throw new ShapeError(
          'light_attention_membrane: argmax index out of range',
        )
      }
      return label
    },
  }
