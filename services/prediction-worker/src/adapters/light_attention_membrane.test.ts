import { describe, it, expect } from 'vitest'

import { ShapeError } from './errors.ts'
import {
  lightAttentionMembraneAdapter,
  MEMBRANE_LABELS,
} from './light_attention_membrane.ts'

function makeFp32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

describe('lightAttentionMembraneAdapter', () => {
  describe('MEMBRANE_LABELS', () => {
    it('has exactly 2 entries with correct strings', () => {
      expect(MEMBRANE_LABELS).toHaveLength(2)
      expect(MEMBRANE_LABELS[0]).toBe('Membrane bound')
      expect(MEMBRANE_LABELS[1]).toBe('Soluble')
    })
  })

  describe('buildRequest', () => {
    it('sends two inputs (input + mask) and requests single output', () => {
      const seqLen = 5
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = lightAttentionMembraneAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'MKTIN',
      })

      expect(req.model_name).toBe('light_attention_membrane')
      expect(req.inputs).toHaveLength(2)
      expect(req.inputs.at(0)?.name).toBe('input')
      expect(req.inputs.at(0)?.datatype).toBe('FP32')
      expect(req.inputs.at(0)?.shape).toEqual([seqLen, 1024])
      expect(req.inputs.at(1)?.name).toBe('mask')
      expect(req.inputs.at(1)?.datatype).toBe('FP32')
      expect(req.inputs.at(1)?.shape).toEqual([seqLen])
      expect(req.outputs).toEqual([{ name: 'output' }])
      expect(req.raw_input_contents).toHaveLength(2)
    })
  })

  describe('decodeResponse', () => {
    it('returns Soluble when index 1 is dominant ([0.1, 0.9])', () => {
      const rawBuf = makeFp32Buffer([0.1, 0.9])
      const response = {
        model_name: 'light_attention_membrane',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [2],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf],
      }
      const result = lightAttentionMembraneAdapter.decodeResponse(response)
      expect(result).toBe('Soluble')
    })

    it('returns Membrane bound when index 0 is dominant ([0.9, 0.1])', () => {
      const rawBuf = makeFp32Buffer([0.9, 0.1])
      const response = {
        model_name: 'light_attention_membrane',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [2],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf],
      }
      const result = lightAttentionMembraneAdapter.decodeResponse(response)
      expect(result).toBe('Membrane bound')
    })

    it('falls back to fp32_contents when raw_output_contents is empty', () => {
      const response = {
        model_name: 'light_attention_membrane',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [2],
            contents: {
              fp32_contents: [0.3, 0.7],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }
      const result = lightAttentionMembraneAdapter.decodeResponse(response)
      expect(result).toBe('Soluble')
    })
  })

  describe('error handling', () => {
    it('throws ShapeError if output length does not match 2 classes', () => {
      const rawBuf = makeFp32Buffer([0.1, 0.2, 0.7])
      const response = {
        model_name: 'light_attention_membrane',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [3],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [rawBuf],
      }
      expect(() =>
        lightAttentionMembraneAdapter.decodeResponse(response),
      ).toThrow(ShapeError)
    })
  })
})
