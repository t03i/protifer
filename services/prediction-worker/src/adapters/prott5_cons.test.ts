import { describe, it, expect } from 'vitest'

import { ShapeError } from './errors.ts'
import { prott5ConsAdapter } from './prott5_cons.ts'

function makeFp32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

describe('prott5ConsAdapter', () => {
  describe('buildRequest', () => {
    it('returns correct model_name, input name, datatype, and shape', () => {
      const seqLen = 4
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = prott5ConsAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'MKTI',
      })

      expect(req.model_name).toBe('prott5_cons')
      expect(req.inputs.at(0)?.name).toBe('input')
      expect(req.inputs.at(0)?.datatype).toBe('FP32')
      expect(req.inputs.at(0)?.shape).toEqual([seqLen, 1024])
      expect(req.outputs).toEqual([{ name: 'output' }])
      expect(req.raw_input_contents?.at(0)?.length).toBe(seqLen * 1024 * 4)
    })
  })

  describe('decodeResponse (raw_output_contents primary)', () => {
    it('returns argmax per residue for [3, 9] FP32 output', () => {
      const values: number[] = [
        0.1,
        0.2,
        9.0,
        0.1,
        0.1,
        0.1,
        0.1,
        0.1,
        0.1, // residue 0 → class 2
        0.1,
        0.1,
        0.1,
        0.1,
        0.1,
        0.1,
        0.1,
        9.0,
        0.1, // residue 1 → class 7
        9.0,
        0.1,
        0.1,
        0.1,
        0.1,
        0.1,
        0.1,
        0.1,
        0.1, // residue 2 → class 0
      ]
      const rawBuf = makeFp32Buffer(values)

      const response = {
        model_name: 'prott5_cons',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [3, 9],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf],
      }

      const result = prott5ConsAdapter.decodeResponse(response)
      expect(result).toHaveLength(3)
      expect(result[0]).toBe(2)
      expect(result[1]).toBe(7)
      expect(result[2]).toBe(0)
    })
  })

  describe('decodeResponse (contents.fp32_contents fallback)', () => {
    it('falls back to fp32_contents when raw_output_contents is empty', () => {
      // 2 residues, 9 classes each; residue 0 → class 3, residue 1 → class 5
      const fp32Values = [
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0, // residue 0 → class 3
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0, // residue 1 → class 5
      ] as number[]

      const response = {
        model_name: 'prott5_cons',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [2, 9],
            contents: {
              fp32_contents: fp32Values,
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }

      const result = prott5ConsAdapter.decodeResponse(response)
      expect(result).toHaveLength(2)
      expect(result[0]).toBe(3)
      expect(result[1]).toBe(5)
    })
  })

  describe('error handling', () => {
    it('throws ShapeError when output length is not divisible by 9', () => {
      const rawBuf = makeFp32Buffer([0.1, 0.2, 0.3, 0.4]) // 4 values, not divisible by 9
      const response = {
        model_name: 'prott5_cons',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [1, 4],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf],
      }
      expect(() => prott5ConsAdapter.decodeResponse(response)).toThrow(
        ShapeError,
      )
    })
  })
})
