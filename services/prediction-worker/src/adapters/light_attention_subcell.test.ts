import { describe, it, expect } from 'vitest'

import { ShapeError } from './errors.ts'
import { ADAPTER_REGISTRY } from './index.ts'
import {
  lightAttentionSubcellAdapter,
  SUBCELL_LABELS,
} from './light_attention_subcell.ts'

function makeFp32Buffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

/** Build a 10-float response where dominantIdx is the argmax. */
function makeSubcellResponse(dominantIdx: number) {
  const values = new Array(10).fill(0.0) as number[]
  values[dominantIdx] = 1.0
  const rawBuf = makeFp32Buffer(values)
  return {
    model_name: 'light_attention_subcell',
    outputs: [
      {
        name: 'output',
        datatype: 'FP32',
        shape: [10],
        contents: { fp32_contents: [], bytes_contents: [], int64_contents: [] },
      },
    ],
    raw_output_contents: [rawBuf],
  }
}

describe('lightAttentionSubcellAdapter', () => {
  describe('SUBCELL_LABELS', () => {
    it('has exactly 10 entries with correct dot-form strings', () => {
      expect(SUBCELL_LABELS).toHaveLength(10)
      expect(SUBCELL_LABELS[0]).toBe('Cell.membrane')
      expect(SUBCELL_LABELS[1]).toBe('Cytoplasm')
      expect(SUBCELL_LABELS[2]).toBe('Endoplasmic.reticulum')
      expect(SUBCELL_LABELS[3]).toBe('Golgi.apparatus')
      expect(SUBCELL_LABELS[4]).toBe('Lysosome/Vacuole')
      expect(SUBCELL_LABELS[5]).toBe('Mitochondrion')
      expect(SUBCELL_LABELS[6]).toBe('Nucleus')
      expect(SUBCELL_LABELS[7]).toBe('Peroxisome')
      expect(SUBCELL_LABELS[8]).toBe('Plastid')
      expect(SUBCELL_LABELS[9]).toBe('Extracellular')
    })
  })

  describe('buildRequest', () => {
    it('sends two inputs (input + mask) and requests single output', () => {
      const seqLen = 3
      const embeddingFp32 = new Float32Array(seqLen * 1024)
      const mask = new Float32Array(seqLen).fill(1.0)
      const req = lightAttentionSubcellAdapter.buildRequest({
        embeddingFp32,
        mask,
        seqLen,
        sequence: 'MKT',
      })

      expect(req.model_name).toBe('light_attention_subcell')
      expect(req.inputs).toHaveLength(2)
      expect(req.inputs.at(0)?.name).toBe('input')
      expect(req.inputs.at(1)?.name).toBe('mask')
      expect(req.outputs).toEqual([{ name: 'output' }])
      expect(req.raw_input_contents).toHaveLength(2)
    })
  })

  describe('decodeResponse', () => {
    it('returns "Cell membrane" (dot→space) when index 0 is dominant', () => {
      const result = lightAttentionSubcellAdapter.decodeResponse(
        makeSubcellResponse(0),
      )
      expect(result).toBe('Cell membrane')
    })

    it('returns "Endoplasmic reticulum" (dot→space) when index 2 is dominant', () => {
      const result = lightAttentionSubcellAdapter.decodeResponse(
        makeSubcellResponse(2),
      )
      expect(result).toBe('Endoplasmic reticulum')
    })

    it('returns "Extracellular" for index 9 (no dot, unchanged)', () => {
      const result = lightAttentionSubcellAdapter.decodeResponse(
        makeSubcellResponse(9),
      )
      expect(result).toBe('Extracellular')
    })

    it('falls back to fp32_contents when raw_output_contents is empty', () => {
      const fp32Values = new Array(10).fill(0.0) as number[]
      fp32Values[5] = 1.0 // Mitochondrion

      const response = {
        model_name: 'light_attention_subcell',
        outputs: [
          {
            name: 'output',
            datatype: 'FP32',
            shape: [10],
            contents: {
              fp32_contents: fp32Values,
              bytes_contents: [],
              int64_contents: [],
            },
          },
        ],
        raw_output_contents: [],
      }
      const result = lightAttentionSubcellAdapter.decodeResponse(response)
      expect(result).toBe('Mitochondrion')
    })
  })

  describe('error handling', () => {
    it('throws ShapeError if output length does not match 10 classes', () => {
      const rawBuf = makeFp32Buffer([0.1, 0.9]) // 2 values instead of 10
      const response = {
        model_name: 'light_attention_subcell',
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
      expect(() =>
        lightAttentionSubcellAdapter.decodeResponse(response),
      ).toThrow(ShapeError)
    })
  })
})

describe('ADAPTER_REGISTRY', () => {
  it('has exactly 8 keys', () => {
    expect(Object.keys(ADAPTER_REGISTRY)).toHaveLength(8)
  })

  it('keys match the 8 Triton model names', () => {
    const keys = Object.keys(ADAPTER_REGISTRY)
    expect(keys).toContain('prott5_sec')
    expect(keys).toContain('tmbed')
    expect(keys).toContain('seth')
    expect(keys).toContain('bind_embed')
    expect(keys).toContain('prott5_cons')
    expect(keys).toContain('vespag')
    expect(keys).toContain('light_attention_subcell')
    expect(keys).toContain('light_attention_membrane')
  })

  it('every adapter has modelName, outputKey, buildRequest, decodeResponse', () => {
    for (const adapter of Object.values(ADAPTER_REGISTRY)) {
      expect(typeof adapter.modelName).toBe('string')
      expect(typeof adapter.outputKey).toBe('string')
      expect(typeof adapter.buildRequest).toBe('function')
      expect(typeof adapter.decodeResponse).toBe('function')
    }
  })

  it('has no duplicate modelNames', () => {
    const modelNames = Object.values(ADAPTER_REGISTRY).map((a) => a.modelName)
    const unique = new Set(modelNames)
    expect(unique.size).toBe(modelNames.length)
  })

  it('does not include goPredSim or prot_t5_pipeline', () => {
    const keys = Object.keys(ADAPTER_REGISTRY)
    expect(keys).not.toContain('goPredSim')
    expect(keys).not.toContain('prot_t5_pipeline')
  })
})
