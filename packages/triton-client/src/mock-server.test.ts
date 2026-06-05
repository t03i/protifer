import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import type { TritonClient } from './client.ts'
import { createTritonClient } from './client.ts'
import type { MockTritonServer } from './mock-server.ts'
import {
  makePredictionOutputs,
  startMockTritonServer,
  MOCK_READY_MODELS,
} from './mock-server.ts'

describe('makePredictionOutputs', () => {
  it('seth is a number[] with values in [0, 1]', () => {
    const out = makePredictionOutputs(20)
    const seth = out.seth ?? []
    expect(Array.isArray(seth)).toBe(true)
    expect(seth).toHaveLength(20)
    expect(seth.every((v) => typeof v === 'number' && v >= 0 && v <= 1)).toBe(
      true,
    )
  })

  it('bindembed.metal uses only b and - characters (D-14 alphabet)', () => {
    const out = makePredictionOutputs(20)
    expect(/^[b\-]+$/.test(out.bindembed?.metal ?? '')).toBe(true)
  })

  it('bindembed.nucleicAcids uses only b and - characters (D-14 alphabet)', () => {
    const out = makePredictionOutputs(20)
    expect(/^[b\-]+$/.test(out.bindembed?.nucleicAcids ?? '')).toBe(true)
  })

  it('bindembed.smallMolecules uses only b and - characters (D-14 alphabet, no S)', () => {
    const out = makePredictionOutputs(20)
    expect(/^[b\-]+$/.test(out.bindembed?.smallMolecules ?? '')).toBe(true)
  })

  it('tmbed labels and probabilities are present', () => {
    const out = makePredictionOutputs(20)
    const tmbed = out.tmbed
    expect(tmbed).toBeDefined()
    expect(typeof tmbed?.labels).toBe('string')
    expect(Array.isArray(tmbed?.probabilities)).toBe(true)
  })

  it('tmbed uses only valid topology characters', () => {
    const out = makePredictionOutputs(20)
    expect(/^[iHohBbSs]+$/.test(out.tmbed?.labels ?? '')).toBe(true)
  })

  it('dssp3 uses only H E C characters', () => {
    const out = makePredictionOutputs(20)
    expect(/^[HEC]+$/.test(out.prott5_secondary_structure?.dssp3 ?? '')).toBe(
      true,
    )
  })

  it('dssp8 uses only valid 8-state characters', () => {
    const out = makePredictionOutputs(20)
    expect(
      /^[HGIBESTCchbt]+$/.test(out.prott5_secondary_structure?.dssp8 ?? ''),
    ).toBe(true)
  })

  it('conservation values are integers in range 0–9', () => {
    const out = makePredictionOutputs(20)
    const cons = out.prott5_conservation ?? []
    expect(cons).toHaveLength(20)
    expect(cons.every((v) => Number.isInteger(v) && v >= 0 && v <= 9)).toBe(
      true,
    )
  })

  it('light_attention_subcellular uses hyphenated format', () => {
    const out = makePredictionOutputs(20)
    expect(out.light_attention_subcellular).toBe('Cell membrane')
  })

  it('light_attention_membrane is a full label', () => {
    const out = makePredictionOutputs(20)
    expect(out.light_attention_membrane).toBe('Membrane bound')
  })

  it('all per-residue outputs have correct length', () => {
    const out = makePredictionOutputs(50)
    expect(out.seth).toHaveLength(50)
    expect(out.tmbed?.labels).toHaveLength(50)
    expect(out.prott5_secondary_structure?.dssp3).toHaveLength(50)
    expect(out.prott5_conservation).toHaveLength(50)
  })
})

describe('variation output', () => {
  it('variation has x_axis, y_axis, values', () => {
    const out = makePredictionOutputs(10)
    const v = out.variation
    expect(v).toBeDefined()
    if (!v) return
    expect(v.x_axis).toHaveLength(10)
    expect(v.y_axis).toHaveLength(20)
    expect(v.values).toHaveLength(20)
    expect(v.values[0]).toHaveLength(10)
  })

  it('variation values are numbers', () => {
    const out = makePredictionOutputs(5)
    const v = out.variation
    if (!v) return
    expect(
      v.values.every((row) => row.every((val) => typeof val === 'number')),
    ).toBe(true)
  })
})

describe('MOCK_READY_MODELS allowlist', () => {
  it('has at least 21 entries (dispatched set + internal ensemble steps)', () => {
    expect(MOCK_READY_MODELS.length).toBeGreaterThanOrEqual(21)
  })

  it('includes all 9 dispatched model names', () => {
    const dispatched = [
      'prot_t5_pipeline',
      'vespag',
      'tmbed',
      'seth',
      'bind_embed',
      'prott5_cons',
      'prott5_sec',
      'light_attention_membrane',
      'light_attention_subcell',
    ]
    for (const name of dispatched) {
      expect(MOCK_READY_MODELS).toContain(name)
    }
  })

  it('includes internal ensemble model names (tokenizer, CV steps, viterbi)', () => {
    const internal = [
      '_internal_prott5_tokenizer',
      '_internal_prott5_onnx',
      '_tmbed_cv0',
      '_tmbed_cv1',
      '_tmbed_cv2',
      '_tmbed_cv3',
      '_tmbed_cv4',
      '_tmbed_viterbi',
      '_bind_embed_cv0',
      '_bind_embed_cv1',
      '_bind_embed_cv2',
      '_bind_embed_cv3',
      '_bind_embed_cv4',
    ]
    for (const name of internal) {
      expect(MOCK_READY_MODELS).toContain(name)
    }
  })

  it('does not include unknown names like predict or embedding', () => {
    expect(MOCK_READY_MODELS).not.toContain('predict')
    expect(MOCK_READY_MODELS).not.toContain('embedding')
    expect(MOCK_READY_MODELS).not.toContain('foobar_unknown')
  })
})

describe('binding alphabet REF_* constants (D-14)', () => {
  it('REF_SMALL contains only b and - characters (no S)', () => {
    const out = makePredictionOutputs(400)
    const small = out.bindembed?.smallMolecules ?? ''
    expect(/^[b\-]+$/.test(small)).toBe(true)
    expect(small).not.toContain('S')
    expect(small).not.toContain('M')
    expect(small).not.toContain('N')
  })

  it('REF_METAL contains only - characters', () => {
    const out = makePredictionOutputs(400)
    const metal = out.bindembed?.metal ?? ''
    expect(/^[-]+$/.test(metal)).toBe(true)
  })

  it('REF_NUCLEIC contains only - characters', () => {
    const out = makePredictionOutputs(400)
    const nucleic = out.bindembed?.nucleicAcids ?? ''
    expect(/^[-]+$/.test(nucleic)).toBe(true)
  })
})

describe('mock Triton gRPC server', () => {
  let server: MockTritonServer
  let client: TritonClient

  beforeAll(async () => {
    server = await startMockTritonServer(0)
    client = createTritonClient(`localhost:${server.port.toString()}`)
  })

  afterAll(() => {
    server.stop()
    client.close()
  })

  describe('modelReady', () => {
    it('returns true for vespag (dispatched model)', async () => {
      const result = await client.modelReady('vespag')
      expect(result).toBe(true)
    })

    it('returns true for all 9 dispatched model names', async () => {
      const dispatched = [
        'prot_t5_pipeline',
        'vespag',
        'tmbed',
        'seth',
        'bind_embed',
        'prott5_cons',
        'prott5_sec',
        'light_attention_membrane',
        'light_attention_subcell',
      ]
      for (const name of dispatched) {
        expect(await client.modelReady(name)).toBe(true)
      }
    })

    it('returns false for unknown model name foobar_unknown', async () => {
      const result = await client.modelReady('foobar_unknown')
      expect(result).toBe(false)
    })

    it('returns false for old model name predict', async () => {
      const result = await client.modelReady('predict')
      expect(result).toBe(false)
    })

    it('returns false for old model name embedding', async () => {
      const result = await client.modelReady('embedding')
      expect(result).toBe(false)
    })
  })

  describe('modelInfer payload size ceiling (#67)', () => {
    it('accepts >4 MB responses that would exceed the default gRPC cap', async () => {
      const seqLen = 3000
      const sequenceBytes = Buffer.alloc(seqLen, 0x41)
      const lenBuf = Buffer.alloc(4)
      lenBuf.writeUInt32LE(sequenceBytes.length, 0)
      const bytesBuf = Buffer.concat([lenBuf, sequenceBytes])

      const response = await client.modelInfer({
        model_name: 'prot_t5_pipeline',
        inputs: [
          {
            name: 'sequences',
            datatype: 'BYTES',
            shape: [1],
            contents: { bytes_contents: [sequenceBytes] },
          },
        ],
        outputs: [{ name: 'embeddings' }],
        raw_input_contents: [bytesBuf],
      })

      const payload = response.raw_output_contents[0]
      expect(payload).toBeDefined()
      if (!payload) throw new Error('missing raw_output_contents[0]')
      expect(payload.length).toBe(seqLen * 1024 * 2)
      expect(payload.length).toBeGreaterThan(4 * 1024 * 1024)
    }, 20_000)

    it('accepts >4 MB prediction-model requests (server receive side)', async () => {
      // P38398/BRCA1 regression: a [seqLen,1024] FP32 embedding at seqLen=1863
      // is ~7.6 MB, exceeding the grpc-js default 4 MiB server receive cap.
      // Server options must match the 64 MB client cap.
      const seqLen = 1863
      const embeddingBuf = Buffer.alloc(seqLen * 1024 * 4)
      const maskBuf = Buffer.alloc(seqLen * 4)
      expect(embeddingBuf.length).toBeGreaterThan(4 * 1024 * 1024)

      const response = await client.modelInfer({
        model_name: 'seth',
        inputs: [
          { name: 'input', datatype: 'FP32', shape: [seqLen, 1024] },
          { name: 'mask', datatype: 'FP32', shape: [seqLen] },
        ],
        outputs: [{ name: 'disorder' }],
        raw_input_contents: [embeddingBuf, maskBuf],
      })

      expect(response.raw_output_contents.length).toBeGreaterThan(0)
    }, 20_000)
  })

  describe('modelInfer prot_t5_pipeline', () => {
    it('returns FP16 raw_output_contents of length seqLen * 1024 * 2', async () => {
      const seqLen = 20
      const sequenceBytes = Buffer.from('ACDEFGHIKLMNPQRSTVWY', 'utf8')
      const lenBuf = Buffer.alloc(4)
      lenBuf.writeUInt32LE(sequenceBytes.length, 0)
      const bytesBuf = Buffer.concat([lenBuf, sequenceBytes])

      const response = await client.modelInfer({
        model_name: 'prot_t5_pipeline',
        inputs: [
          {
            name: 'sequences',
            datatype: 'BYTES',
            shape: [1],
            contents: { bytes_contents: [sequenceBytes] },
          },
        ],
        outputs: [{ name: 'embeddings' }],
        raw_input_contents: [bytesBuf],
      })

      expect(response.raw_output_contents).toHaveLength(1)
      expect(response.raw_output_contents[0]?.length).toBe(seqLen * 1024 * 2)
    })
  })

  describe('modelInfer vespag', () => {
    it('returns FP32 raw_output_contents of length seqLen * 20 * 4', async () => {
      const seqLen = 20
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)

      const response = await client.modelInfer({
        model_name: 'vespag',
        inputs: [{ name: 'input', datatype: 'FP32', shape: [seqLen, 1024] }],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf],
      })

      expect(response.raw_output_contents).toHaveLength(1)
      expect(response.raw_output_contents[0]?.length).toBe(seqLen * 20 * 4)
    })
  })

  describe('modelInfer tmbed', () => {
    it('returns 2 raw outputs: BYTES labels + FP32 probabilities', async () => {
      const seqLen = 20
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)
      const maskBuf = Buffer.alloc(seqLen * 4)

      const response = await client.modelInfer({
        model_name: 'tmbed',
        inputs: [
          { name: 'ensemble_input', datatype: 'FP32', shape: [seqLen, 1024] },
          { name: 'mask', datatype: 'FP32', shape: [seqLen] },
        ],
        outputs: [{ name: 'labels' }, { name: 'probabilities' }],
        raw_input_contents: [embBuf, maskBuf],
      })

      expect(response.raw_output_contents).toHaveLength(2)
      // labels buffer: 4-byte prefix + seqLen bytes (at minimum)
      expect(response.raw_output_contents[0]?.length ?? 0).toBeGreaterThan(4)
      expect(response.raw_output_contents[1]?.length).toBe(seqLen * 5 * 4)
    })

    it('labels buffer starts with a valid LE uint32 length prefix', async () => {
      const seqLen = 5
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)
      const maskBuf = Buffer.alloc(seqLen * 4)

      const response = await client.modelInfer({
        model_name: 'tmbed',
        inputs: [
          { name: 'ensemble_input', datatype: 'FP32', shape: [seqLen, 1024] },
          { name: 'mask', datatype: 'FP32', shape: [seqLen] },
        ],
        outputs: [{ name: 'labels' }, { name: 'probabilities' }],
        raw_input_contents: [embBuf, maskBuf],
      })

      const labelsBuf = response.raw_output_contents[0]
      expect(labelsBuf).toBeDefined()
      if (!labelsBuf) return
      const declaredLen = labelsBuf.readUInt32LE(0)
      expect(declaredLen).toBe(seqLen)
      expect(labelsBuf.length).toBe(4 + seqLen)
    })
  })

  describe('modelInfer seth', () => {
    it('returns FP32 raw_output_contents of length seqLen * 1 * 4', async () => {
      const seqLen = 20
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)

      const response = await client.modelInfer({
        model_name: 'seth',
        inputs: [{ name: 'input', datatype: 'FP32', shape: [seqLen, 1024] }],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf],
      })

      expect(response.raw_output_contents).toHaveLength(1)
      expect(response.raw_output_contents[0]?.length).toBe(seqLen * 1 * 4)
    })
  })

  describe('modelInfer bind_embed', () => {
    it('returns 5 FP32 raw outputs each of length seqLen * 3 * 4', async () => {
      const seqLen = 20
      const transposedBuf = Buffer.alloc(1024 * seqLen * 4)

      const response = await client.modelInfer({
        model_name: 'bind_embed',
        inputs: [{ name: 'input', datatype: 'FP32', shape: [1024, seqLen] }],
        outputs: [
          { name: 'output_0' },
          { name: 'output_1' },
          { name: 'output_2' },
          { name: 'output_3' },
          { name: 'output_4' },
        ],
        raw_input_contents: [transposedBuf],
      })

      expect(response.raw_output_contents).toHaveLength(5)
      for (const buf of response.raw_output_contents) {
        expect(buf.length).toBe(seqLen * 3 * 4)
      }
    })
  })

  describe('modelInfer prott5_cons', () => {
    it('returns FP32 raw_output_contents of length seqLen * 9 * 4', async () => {
      const seqLen = 20
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)

      const response = await client.modelInfer({
        model_name: 'prott5_cons',
        inputs: [{ name: 'input', datatype: 'FP32', shape: [seqLen, 1024] }],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf],
      })

      expect(response.raw_output_contents).toHaveLength(1)
      expect(response.raw_output_contents[0]?.length).toBe(seqLen * 9 * 4)
    })
  })

  describe('modelInfer prott5_sec', () => {
    it('returns 2 FP32 raw outputs: d3_Yhat [seqLen,3] and d8_Yhat [seqLen,8]', async () => {
      const seqLen = 20
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)

      const response = await client.modelInfer({
        model_name: 'prott5_sec',
        inputs: [{ name: 'input', datatype: 'FP32', shape: [seqLen, 1024] }],
        outputs: [{ name: 'd3_Yhat' }, { name: 'd8_Yhat' }],
        raw_input_contents: [embBuf],
      })

      expect(response.raw_output_contents).toHaveLength(2)
      expect(response.raw_output_contents[0]?.length).toBe(seqLen * 3 * 4)
      expect(response.raw_output_contents[1]?.length).toBe(seqLen * 8 * 4)
    })
  })

  describe('modelInfer light_attention_membrane', () => {
    it('returns FP32 raw_output_contents of length 2 * 4 (shape [2])', async () => {
      const seqLen = 20
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)
      const maskBuf = Buffer.alloc(seqLen * 4)

      const response = await client.modelInfer({
        model_name: 'light_attention_membrane',
        inputs: [
          { name: 'input', datatype: 'FP32', shape: [seqLen, 1024] },
          { name: 'mask', datatype: 'FP32', shape: [seqLen] },
        ],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf, maskBuf],
      })

      expect(response.raw_output_contents).toHaveLength(1)
      expect(response.raw_output_contents[0]?.length).toBe(2 * 4)
    })

    it('argmax of output is 0 (Membrane bound)', async () => {
      const seqLen = 5
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)
      const maskBuf = Buffer.alloc(seqLen * 4)

      const response = await client.modelInfer({
        model_name: 'light_attention_membrane',
        inputs: [
          { name: 'input', datatype: 'FP32', shape: [seqLen, 1024] },
          { name: 'mask', datatype: 'FP32', shape: [seqLen] },
        ],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf, maskBuf],
      })

      const buf = response.raw_output_contents[0]
      expect(buf).toBeDefined()
      if (!buf) return
      const v0 = buf.readFloatLE(0)
      const v1 = buf.readFloatLE(4)
      expect(v0).toBeGreaterThan(v1) // argmax = 0 → Membrane bound
    })
  })

  describe('modelInfer light_attention_subcell', () => {
    it('returns FP32 raw_output_contents of length 10 * 4 (shape [10])', async () => {
      const seqLen = 20
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)
      const maskBuf = Buffer.alloc(seqLen * 4)

      const response = await client.modelInfer({
        model_name: 'light_attention_subcell',
        inputs: [
          { name: 'input', datatype: 'FP32', shape: [seqLen, 1024] },
          { name: 'mask', datatype: 'FP32', shape: [seqLen] },
        ],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf, maskBuf],
      })

      expect(response.raw_output_contents).toHaveLength(1)
      expect(response.raw_output_contents[0]?.length).toBe(10 * 4)
    })

    it('argmax of output is 1 (Cytoplasm)', async () => {
      const seqLen = 5
      const embBuf = Buffer.alloc(seqLen * 1024 * 4)
      const maskBuf = Buffer.alloc(seqLen * 4)

      const response = await client.modelInfer({
        model_name: 'light_attention_subcell',
        inputs: [
          { name: 'input', datatype: 'FP32', shape: [seqLen, 1024] },
          { name: 'mask', datatype: 'FP32', shape: [seqLen] },
        ],
        outputs: [{ name: 'output' }],
        raw_input_contents: [embBuf, maskBuf],
      })

      const buf = response.raw_output_contents[0]
      expect(buf).toBeDefined()
      if (!buf) return
      const v1 = buf.readFloatLE(4) // index 1 = Cytoplasm
      const v0 = buf.readFloatLE(0) // index 0 = Cell.membrane
      expect(v1).toBeGreaterThan(v0) // argmax = 1
    })
  })

  describe('modelInfer unknown model name', () => {
    it('rejects model_name predict with error or empty outputs', async () => {
      let caughtError = false
      let emptyOutputs = false
      try {
        const response = await client.modelInfer({
          model_name: 'predict',
          inputs: [],
          outputs: [],
        })
        emptyOutputs = response.outputs.length === 0
      } catch {
        caughtError = true
      }
      expect(caughtError || emptyOutputs).toBe(true)
    })

    it('modelReady predict returns false', async () => {
      expect(await client.modelReady('predict')).toBe(false)
    })
  })
})
