import { describe, it, expect } from 'vitest'

import { ShapeError } from './errors.ts'
import { vespagAdapter } from './vespag.ts'

/** Build a raw FP32 buffer: n floats, each equal to `value`. */
function makeFp32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

const AMINO_ACIDS_LEN = 20

describe('vespagAdapter', () => {
  describe('buildRequest', () => {
    it('returns correct model_name, input name, datatype, and shape', () => {
      const seqLen = 3
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = vespagAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'ACE',
      })

      expect(req.model_name).toBe('vespag')
      expect(req.inputs).toHaveLength(1)
      expect(req.inputs.at(0)?.name).toBe('input')
      expect(req.inputs.at(0)?.datatype).toBe('FP32')
      expect(req.inputs.at(0)?.shape).toEqual([seqLen, 1024])
      expect(req.outputs).toEqual([{ name: 'output' }])
      expect(req.raw_input_contents).toHaveLength(1)
      expect(req.raw_input_contents?.at(0)).toBeInstanceOf(Buffer)
      expect(req.raw_input_contents?.at(0)?.length).toBe(seqLen * 1024 * 4)
    })
  })

  describe('decodeResponse (raw_output_contents primary)', () => {
    it('decodes [seqLen=2, 20] FP32 output to VariationOutput', () => {
      const seqLen = 2
      const values = new Array(seqLen * AMINO_ACIDS_LEN)
        .fill(0)
        .map((_, i) => i * 0.1)
      const rawBuf = makeFp32Buffer(values)

      const response = {
        model_name: 'vespag',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [seqLen, AMINO_ACIDS_LEN],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf],
      }

      const result = vespagAdapter.decodeResponse(response)

      expect(result.x_axis).toHaveLength(seqLen)
      expect(result.y_axis).toHaveLength(AMINO_ACIDS_LEN)
      expect(result.values).toHaveLength(AMINO_ACIDS_LEN)
      expect(result.values[0]).toHaveLength(seqLen)
      // First row (amino acid 0, residue 0): flat[0*20+0] = 0.0
      expect(result.values[0]?.at(0)).toBeCloseTo(0.0)
      // Second row (amino acid 1, residue 0): flat[0*20+1] = 0.1
      expect(result.values[1]?.at(0)).toBeCloseTo(0.1)
    })
  })

  describe('decodeResponse (contents.fp32_contents fallback)', () => {
    it('falls back to fp32_contents when raw_output_contents is empty', () => {
      const seqLen = 2
      const fp32Values = new Array(seqLen * AMINO_ACIDS_LEN).fill(
        0.5,
      ) as number[]

      const response = {
        model_name: 'vespag',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [seqLen, AMINO_ACIDS_LEN],
            contents: {
              fp32_contents: fp32Values,
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }

      const result = vespagAdapter.decodeResponse(response)
      expect(result.x_axis).toHaveLength(seqLen)
      expect(result.y_axis).toHaveLength(AMINO_ACIDS_LEN)
      expect(result.values[0]?.at(0)).toBeCloseTo(0.5)
    })
  })

  describe('error handling', () => {
    it('throws ShapeError for empty output', () => {
      const response = {
        model_name: 'vespag',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [0, AMINO_ACIDS_LEN],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }
      expect(() => vespagAdapter.decodeResponse(response)).toThrow(ShapeError)
    })

    it('throws ShapeError when output length is not divisible by 20', () => {
      const rawBuf = makeFp32Buffer([0.1, 0.2, 0.3]) // length 3, not divisible by 20
      const response = {
        model_name: 'vespag',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [1, 3],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf],
      }
      expect(() => vespagAdapter.decodeResponse(response)).toThrow(ShapeError)
    })
  })
})
