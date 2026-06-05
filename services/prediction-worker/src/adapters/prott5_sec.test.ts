import { describe, it, expect } from 'vitest'

import { ShapeError } from './errors.ts'
import { prott5SecAdapter } from './prott5_sec.ts'

function makeFp32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

describe('prott5SecAdapter', () => {
  describe('buildRequest', () => {
    it('returns correct model_name, input name, datatype, and two requested outputs', () => {
      const seqLen = 4
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = prott5SecAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'MKTI',
      })

      expect(req.model_name).toBe('prott5_sec')
      expect(req.inputs.at(0)?.name).toBe('input')
      expect(req.inputs.at(0)?.datatype).toBe('FP32')
      expect(req.inputs.at(0)?.shape).toEqual([seqLen, 1024])
      expect(req.outputs).toContainEqual({ name: 'd3_Yhat' })
      expect(req.outputs).toContainEqual({ name: 'd8_Yhat' })
      expect(req.raw_input_contents?.at(0)?.length).toBe(seqLen * 1024 * 4)
    })
  })

  describe('decodeResponse (raw_output_contents primary)', () => {
    it('decodes d3_Yhat [4,3] + d8_Yhat [4,8] to dssp3 + dssp8 strings', () => {
      const seqLen = 4
      // DSSP3_LABELS = ['H', 'E', 'C']
      // d3: residue 0→H(0), 1→E(1), 2→C(2), 3→H(0)
      const d3Values = [
        9,
        0,
        0, // residue 0 → H
        0,
        9,
        0, // residue 1 → E
        0,
        0,
        9, // residue 2 → C
        9,
        0,
        0, // residue 3 → H
      ]
      // DSSP8_LABELS = ['H', 'G', 'I', 'B', 'E', 'S', 'T', 'C']
      // d8: residue 0→H(0), 1→G(1), 2→I(2), 3→B(3)
      const d8Values = [
        9,
        0,
        0,
        0,
        0,
        0,
        0,
        0, // residue 0 → H
        0,
        9,
        0,
        0,
        0,
        0,
        0,
        0, // residue 1 → G
        0,
        0,
        9,
        0,
        0,
        0,
        0,
        0, // residue 2 → I
        0,
        0,
        0,
        9,
        0,
        0,
        0,
        0, // residue 3 → B
      ]

      const d3Buf = makeFp32Buffer(d3Values)
      const d8Buf = makeFp32Buffer(d8Values)

      const response = {
        model_name: 'prott5_sec',
        outputs: [
          {
            name: 'd3_Yhat',
            datatype: 'FP32',
            shape: [seqLen, 3],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
          {
            name: 'd8_Yhat',
            datatype: 'FP32',
            shape: [seqLen, 8],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [d3Buf, d8Buf],
      }

      const result = prott5SecAdapter.decodeResponse(response)
      expect(result.dssp3).toBe('HECH')
      expect(result.dssp8).toBe('HGIB')
    })
  })

  describe('decodeResponse (contents.fp32_contents fallback)', () => {
    it('falls back to fp32_contents when raw_output_contents is empty', () => {
      const seqLen = 2
      // d3: residue 0→H(0), 1→E(1)
      const d3Values = [9, 0, 0, 0, 9, 0] as number[]
      // d8: residue 0→G(1), 1→T(6)
      const d8Values = [
        0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0,
      ] as number[]

      const response = {
        model_name: 'prott5_sec',
        outputs: [
          {
            name: 'd3_Yhat',
            datatype: 'FP32',
            shape: [seqLen, 3],
            contents: {
              fp32_contents: d3Values,
              bytes_contents: [],
              int64_contents: [],
            },
          },
          {
            name: 'd8_Yhat',
            datatype: 'FP32',
            shape: [seqLen, 8],
            contents: {
              fp32_contents: d8Values,
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }

      const result = prott5SecAdapter.decodeResponse(response)
      expect(result.dssp3).toBe('HE')
      expect(result.dssp8).toBe('GT')
    })
  })

  describe('error handling', () => {
    it('throws ShapeError when d3 output is empty', () => {
      const response = {
        model_name: 'prott5_sec',
        outputs: [],
        raw_output_contents: [],
      }
      expect(() => prott5SecAdapter.decodeResponse(response)).toThrow(
        ShapeError,
      )
    })

    it('throws ShapeError when d3 output length is wrong (not divisible by 3)', () => {
      const rawBuf = makeFp32Buffer([0.1, 0.2]) // 2 values, not divisible by 3
      const d8Buf = makeFp32Buffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
      const response = {
        model_name: 'prott5_sec',
        outputs: [
          {
            name: 'd3_Yhat',
            datatype: 'FP32',
            shape: [1, 2],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
          {
            name: 'd8_Yhat',
            datatype: 'FP32',
            shape: [1, 8],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf, d8Buf],
      }
      expect(() => prott5SecAdapter.decodeResponse(response)).toThrow(
        ShapeError,
      )
    })
  })
})
