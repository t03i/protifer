import { describe, it, expect } from 'vitest'

import { ShapeError } from './errors.ts'
import { sethAdapter } from './seth.ts'

function makeFp32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

describe('sethAdapter', () => {
  describe('buildRequest', () => {
    it('returns correct model_name, input name, datatype, and shape', () => {
      const seqLen = 5
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = sethAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'MKTIL',
      })

      expect(req.model_name).toBe('seth')
      expect(req.inputs.at(0)?.name).toBe('input')
      expect(req.inputs.at(0)?.datatype).toBe('FP32')
      expect(req.inputs.at(0)?.shape).toEqual([seqLen, 1024])
      expect(req.outputs).toEqual([{ name: 'output' }])
      expect(req.raw_input_contents?.at(0)?.length).toBe(seqLen * 1024 * 4)
    })
  })

  describe('decodeResponse (raw_output_contents primary)', () => {
    it('decodes [5, 1] FP32 output to number[] of length 5', () => {
      const values = [0.1, 0.2, 0.3, 0.4, 0.5]
      const rawBuf = makeFp32Buffer(values)

      const response = {
        model_name: 'seth',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [5, 1],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf],
      }

      const result = sethAdapter.decodeResponse(response)
      expect(result).toHaveLength(5)
      expect(result[0]).toBeCloseTo(0.1)
      expect(result[4]).toBeCloseTo(0.5)
    })
  })

  describe('decodeResponse (contents.fp32_contents fallback)', () => {
    it('falls back to fp32_contents when raw_output_contents is empty', () => {
      const fp32Values = [0.9, 0.8, 0.7] as number[]
      const response = {
        model_name: 'seth',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [3, 1],
            contents: {
              fp32_contents: fp32Values,
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }
      const result = sethAdapter.decodeResponse(response)
      expect(result).toHaveLength(3)
      expect(result[0]).toBeCloseTo(0.9)
    })
  })

  describe('error handling', () => {
    it('throws ShapeError for empty output', () => {
      const response = {
        model_name: 'seth',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [0, 1],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }
      expect(() => sethAdapter.decodeResponse(response)).toThrow(ShapeError)
    })
  })
})
