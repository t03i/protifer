import { describe, it, expect } from 'vitest'

import { bindEmbedAdapter } from './bind_embed.ts'
import { ShapeError } from './errors.ts'

function makeFp32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

/**
 * Build a response with 5 CV outputs each shaped [seqLen, 3].
 * allValues: flat array of length 5 * seqLen * 3.
 * If useRaw, puts them in raw_output_contents; otherwise in fp32_contents.
 */
function makeFiveCvResponse(
  seqLen: number,
  cvValues: number[][],
  useRaw = true,
) {
  const outputs = cvValues.map((vals, i) => ({
    name: `output_${String(i)}`,
    datatype: 'FP32',
    shape: [seqLen, 3],
    contents: {
      fp32_contents: useRaw ? [] : vals,
      bytes_contents: [],
      int64_contents: [],
    },
  }))
  return {
    model_name: 'bind_embed',
    outputs,
    raw_output_contents: useRaw
      ? cvValues.map((vals) => makeFp32Buffer(vals))
      : [],
  }
}

describe('bindEmbedAdapter', () => {
  describe('buildRequest', () => {
    it('transposes [seqLen, 1024] embedding to [1024, seqLen] layout', () => {
      const seqLen = 3
      // Mark each residue r with value r in all 1024 dims
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      for (let r = 0; r < seqLen; r++) {
        for (let c = 0; c < 1024; c++) {
          embeddingFp32[r * 1024 + c] = r + 0.0
        }
      }
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = bindEmbedAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'MKT',
      })

      const input0 = req.inputs.at(0)
      expect(input0?.name).toBe('ensemble_input')
      expect(input0?.datatype).toBe('FP32')
      expect(input0?.shape).toEqual([1024, seqLen])

      // Verify transpose: transposed[c * seqLen + r] === r
      const buf = req.raw_input_contents?.at(0)
      expect(buf).toBeDefined()
      if (!buf) return
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      for (let c = 0; c < 1024; c++) {
        for (let r = 0; r < seqLen; r++) {
          const idx = c * seqLen + r
          const val = dv.getFloat32(idx * 4, true)
          expect(val).toBeCloseTo(r)
        }
      }
    })

    it('requests 5 named outputs (output_0..output_4)', () => {
      const seqLen = 2
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = bindEmbedAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'MK',
      })

      expect(req.model_name).toBe('bind_embed')
      expect(req.outputs).toHaveLength(5)
      expect(req.outputs.map((o) => o.name)).toEqual([
        'output_0',
        'output_1',
        'output_2',
        'output_3',
        'output_4',
      ])
    })
  })

  describe('decodeResponse (sigmoid → mean → threshold)', () => {
    it('large positive logits in channel 0 → metal=bbbb, others=----', () => {
      const seqLen = 4
      const cvRow = [10.0, -10.0, -10.0] // [metal, nucleic, small]
      const cvValues = Array(seqLen).fill(cvRow).flat() as number[]
      const allCvs = [cvValues, cvValues, cvValues, cvValues, cvValues]

      const response = makeFiveCvResponse(seqLen, allCvs)
      const result = bindEmbedAdapter.decodeResponse(response)

      expect(result.metal).toBe('bbbb')
      expect(result.nucleicAcids).toBe('----')
      expect(result.smallMolecules).toBe('----')
    })

    it('zero logits → sigmoid=0.5 → mean=0.5 → p>=0.5 → all b (boundary test)', () => {
      const seqLen = 3
      const cvValues = new Array(seqLen * 3).fill(0.0) as number[]
      const allCvs = [cvValues, cvValues, cvValues, cvValues, cvValues]

      const response = makeFiveCvResponse(seqLen, allCvs)
      const result = bindEmbedAdapter.decodeResponse(response)

      expect(result.metal).toBe('bbb')
      expect(result.nucleicAcids).toBe('bbb')
      expect(result.smallMolecules).toBe('bbb')
    })

    it('large negative logits → all ---', () => {
      const seqLen = 2
      const cvValues = new Array(seqLen * 3).fill(-20.0) as number[]
      const allCvs = [cvValues, cvValues, cvValues, cvValues, cvValues]

      const response = makeFiveCvResponse(seqLen, allCvs)
      const result = bindEmbedAdapter.decodeResponse(response)

      expect(result.metal).toBe('--')
      expect(result.nucleicAcids).toBe('--')
      expect(result.smallMolecules).toBe('--')
    })

    it('fallback: uses contents.fp32_contents when raw_output_contents is empty', () => {
      const seqLen = 2
      const cvValues = new Array(seqLen * 3).fill(10.0) as number[] // large positive → all 'b'
      const response = makeFiveCvResponse(
        seqLen,
        [cvValues, cvValues, cvValues, cvValues, cvValues],
        false,
      )

      const result = bindEmbedAdapter.decodeResponse(response)
      expect(result.metal).toBe('bb')
    })
  })

  describe('error handling', () => {
    it('throws ShapeError if fewer than 5 outputs in response', () => {
      const response = {
        // only 1 output provided; adapter requires 5
        model_name: 'bind_embed',
        outputs: [
          {
            name: 'output_0',
            datatype: 'FP32',
            shape: [2, 3],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [makeFp32Buffer([0, 0, 0, 0, 0, 0])],
      }
      expect(() => bindEmbedAdapter.decodeResponse(response)).toThrow(
        ShapeError,
      )
    })
  })
})
