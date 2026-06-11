import { describe, it, expect } from 'vitest'

import { ShapeError, DecodeError } from './errors.ts'
import { tmbedAdapter } from './tmbed.ts'

function makeFp32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

/**
 * Build a KServe v2 BYTES tensor buffer: LE 4-byte length prefix + payload.
 * For a single string, this is: uint32LE(str.length) + str bytes.
 */
function makeBytesBuffer(strings: string[]): Buffer {
  const parts: Buffer[] = []
  for (const s of strings) {
    const payload = Buffer.from(s, 'utf8')
    const hdr = Buffer.alloc(4)
    hdr.writeUInt32LE(payload.length, 0)
    parts.push(hdr, payload)
  }
  return Buffer.concat(parts)
}

describe('tmbedAdapter', () => {
  describe('buildRequest', () => {
    it('sends two inputs (ensemble_input + mask) and requests labels + probabilities', () => {
      const seqLen = 4
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = tmbedAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'MKTI',
      })

      expect(req.model_name).toBe('tmbed')
      expect(req.inputs).toHaveLength(2)
      expect(req.inputs.at(0)?.name).toBe('ensemble_input')
      expect(req.inputs.at(0)?.datatype).toBe('FP32')
      expect(req.inputs.at(0)?.shape).toEqual([1, seqLen, 1024])
      expect(req.inputs.at(1)?.name).toBe('mask')
      expect(req.inputs.at(1)?.datatype).toBe('FP32')
      expect(req.inputs.at(1)?.shape).toEqual([1, seqLen])
      expect(req.outputs).toContainEqual({ name: 'labels' })
      expect(req.outputs).toContainEqual({ name: 'probabilities' })
      expect(req.raw_input_contents).toHaveLength(2)
      expect(req.raw_input_contents?.at(0)?.length).toBe(seqLen * 1024 * 4)
      expect(req.raw_input_contents?.at(1)?.length).toBe(seqLen * 4)
    })
  })

  describe('decodeResponse (labels BYTES round-trip)', () => {
    it('decodes LE length-prefixed BYTES "BHio" + FP32 [4,5] probabilities', () => {
      const labelStr = 'BHio'
      const seqLen = 4
      const N_CLASSES = 5
      const probValues: number[] = []
      for (let r = 0; r < seqLen; r++) {
        for (let c = 0; c < N_CLASSES; c++) {
          probValues.push(r * 0.1 + c * 0.01)
        }
      }
      const labelsBuf = makeBytesBuffer([labelStr])
      const probBuf = makeFp32Buffer(probValues)

      const response = {
        model_name: 'tmbed',
        outputs: [
          {
            name: 'labels',
            datatype: 'BYTES',
            shape: [1],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
          {
            name: 'probabilities',
            datatype: 'FP32',
            shape: [seqLen, N_CLASSES],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [labelsBuf, probBuf],
      }

      const result = tmbedAdapter.decodeResponse(response)
      expect(result.labels).toBe('BHio')
      expect(result.probabilities).toHaveLength(seqLen)
      expect(result.probabilities[0]).toHaveLength(N_CLASSES)
      expect(result.probabilities[0]?.at(0)).toBeCloseTo(0.0)
      expect(result.probabilities[1]?.at(0)).toBeCloseTo(0.1)
    })

    it('decodes labels from contents.bytes_contents fallback', () => {
      const labelStr = 'BH'
      const seqLen = 2
      const N_CLASSES = 5
      const probValues = new Array(seqLen * N_CLASSES).fill(0.2) as number[]

      const response = {
        model_name: 'tmbed',
        outputs: [
          {
            name: 'labels',
            datatype: 'BYTES',
            shape: [1],
            contents: {
              fp32_contents: [],
              bytes_contents: [Buffer.from(labelStr, 'utf8')],
              int64_contents: [],
            },
          },
          {
            name: 'probabilities',
            datatype: 'FP32',
            shape: [seqLen, N_CLASSES],
            contents: {
              fp32_contents: probValues,
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }

      const result = tmbedAdapter.decodeResponse(response)
      expect(result.labels).toBe('BH')
      expect(result.probabilities).toHaveLength(seqLen)
    })
  })

  describe('error handling', () => {
    it('throws DecodeError when labels has 2 BYTES entries', () => {
      const seqLen = 2
      const N_CLASSES = 5
      const labelsBuf = makeBytesBuffer(['BH', 'io'])
      const probBuf = makeFp32Buffer(
        new Array(seqLen * N_CLASSES).fill(0.1) as number[],
      )

      const response = {
        model_name: 'tmbed',
        outputs: [
          {
            name: 'labels',
            datatype: 'BYTES',
            shape: [2],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
          {
            name: 'probabilities',
            datatype: 'FP32',
            shape: [seqLen, N_CLASSES],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [labelsBuf, probBuf],
      }

      expect(() => tmbedAdapter.decodeResponse(response)).toThrow(DecodeError)
    })

    it('throws ShapeError when probabilities length is not divisible by 5', () => {
      const labelsBuf = makeBytesBuffer(['BH'])
      const probBuf = makeFp32Buffer([0.1, 0.2, 0.3, 0.4]) // 4 values, not divisible by 5

      const response = {
        model_name: 'tmbed',
        outputs: [
          {
            name: 'labels',
            datatype: 'BYTES',
            shape: [1],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
          {
            name: 'probabilities',
            datatype: 'FP32',
            shape: [1, 4],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [labelsBuf, probBuf],
      }

      expect(() => tmbedAdapter.decodeResponse(response)).toThrow(ShapeError)
    })

    it('throws ShapeError when labels output buffer is empty', () => {
      const emptyLabelsBuf = Buffer.alloc(0)
      const probBuf = makeFp32Buffer(new Array(5).fill(0.1) as number[])

      const response = {
        model_name: 'tmbed',
        outputs: [
          {
            name: 'labels',
            datatype: 'BYTES',
            shape: [1],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
          {
            name: 'probabilities',
            datatype: 'FP32',
            shape: [1, 5],
            contents: {
              fp32_contents: [],
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [emptyLabelsBuf, probBuf],
      }

      expect(() => tmbedAdapter.decodeResponse(response)).toThrow(ShapeError)
    })
  })
})
