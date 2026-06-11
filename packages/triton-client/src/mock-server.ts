import * as grpc from '@grpc/grpc-js'
import type {
  PredictionOutputs,
  VariationOutput,
  TmbedOutput,
} from '@protifer/shared'

import { TRITON_MAX_MESSAGE_BYTES } from './client.ts'
import type { InferResponse } from './client.ts'
import { AMINO_ACIDS, DSSP3_LABELS, DSSP8_LABELS } from './constants.ts'
import { constantFp16Buffer } from './float16.ts'
import { getPackageDef } from './proto-loader.ts'

export interface MockTritonServer {
  stop(): void
  port: number
}

export const MOCK_READY_MODELS = [
  'prot_t5_pipeline',
  'vespag',
  'tmbed',
  'seth',
  'bind_embed',
  'prott5_cons',
  'prott5_sec',
  'light_attention_membrane',
  'light_attention_subcell',
  // Internal ensemble steps (may be queried individually by the worker)
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
] as const

// Reference fixture data (P17302, 382 residues)

const REF_DSSP3 =
  'CCCHHHHHHHHHHHHHHCCHHHHHHHHHHHHHHHHHHHHHHHHHHCCCCCCEEECCCCCCCCCCCCCCCCCHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHCCCCHHHHHHHHHHHHHHHCCCCCCCCCCCCHHHHHHHHHHHHHHHHHHHHHHHHHHHHCCCCCCCEEEECCCCCCCEEEECCCHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHCHHHHCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCHHHHHHHHHHHHHHCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'

const REF_DSSP8 =
  'CCCHHHHHHHHHHHHHHCCHHHHHHHHHHHHHHHHHHHHHHHHHHCCCCCTEECCSTSTTCCHHEECTTSCHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHTTCCHHHHHHHHHHHHHHHCCCCTTCCCCCTHHHHHHHHHHHHHHHHHHHHHHHHHHHHTTCCCCEEEEECSSCCSEEEEECCCHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHCTCCCCCCCCCCCCCCCCCCCCCCCECCTCCCCCCCCCCCCCCCCCCCCCCCTCCCCCCCCCCHHHHHHHHHHHHHHCTCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'

const REF_TMBED =
  'iiiiiiiiiiiiiiiiiiiiHHHHHHHHHHHHHHHHHHHHHHHoooooooooooooooooooooooooooooohhhhhhhhhhhhhhhhhhhhhhhhiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiHHHHHHHHHHHHHHHHHHHHHHHooooooooooooooooooooooooooooohhhhhhhhhhhhhhhhhhhhhhhhhhiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii'

// Binding alphabet uses only 'b' / '-' (no M, N, S). REF_METAL and REF_NUCLEIC
// are all '-'.
const REF_METAL =
  '----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------'

const REF_NUCLEIC =
  '----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------'

// REF_SMALL — 'S' at position 32 replaced with 'b'
const REF_SMALL =
  '--------------------------------b-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------'

const REF_DISORDER_SCORES: number[] = (() => {
  const binary =
    '---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
  return binary.split('').map((c, i, arr) => {
    if (c === 'X') return 0.85
    const nearX = arr.slice(Math.max(0, i - 3), i + 4).some((ch) => ch === 'X')
    return nearX ? 0.35 : 0.05
  })
})()

const REF_CONSERVATION = [
  8, 8, 7, 8, 6, 4, 8, 6, 4, 6, 8, 7, 6, 7, 8, 5, 6, 8, 8, 5, 6, 7, 5, 6, 8, 5,
  8, 5, 8, 5, 7, 6, 8, 5, 7, 6, 8, 5, 8, 5, 6, 8, 6, 5, 8, 8, 6, 7, 6, 8, 8, 5,
  6, 4, 4, 5, 6, 5, 5, 5, 4, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5,
  5, 5, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
  8, 8, 8, 8, 8, 8, 7, 6, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
]

const REF_VARIATION_ROW = [
  75, 52, 58, 74, 39, 40, 67, 48, 45, 52, 62, 59, 61, 55, 57, 51, 63, 49, 48,
  54, 58, 61, 55, 60, 52, 56, 59, 57, 62, 48, 60, 53, 57, 61, 54, 58, 52, 63,
  56, 50, 61, 55, 58, 60, 52, 57, 63, 56, 50, 58, 61, 55, 60, 52, 57, 63, 56,
  50, 58, 61, 55, 60, 52, 57, 63, 56, 50, 58, 61, 55, 60, 52, 57, 63, 56, 50,
  58, 61, 55, 60,
]

function cycleString(ref: string, n: number): string {
  if (n <= 0) return ''
  if (n <= ref.length) return ref.slice(0, n)
  let result = ''
  while (result.length < n) result += ref
  return result.slice(0, n)
}

function cycleArray<T>(ref: T[], n: number): T[] {
  if (n <= 0) return []
  const out: T[] = []
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  for (let i = 0; i < n; i++) out.push(ref[i % ref.length]!)
  return out
}

function fp32Buf(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  }
  return buf
}

function makeVariationOutput(seqLen: number): VariationOutput {
  const x_axis: string[] = []
  for (let i = 0; i < seqLen; i++) x_axis.push((i + 1).toString())

  const values: number[][] = AMINO_ACIDS.map((_, aaIdx) => {
    const row: number[] = []
    for (let pos = 0; pos < seqLen; pos++) {
      const base =
        REF_VARIATION_ROW[(pos + aaIdx * 7) % REF_VARIATION_ROW.length] ?? 50
      const jitter = ((pos * 13 + aaIdx * 37) % 29) - 14
      row.push(Math.max(0, Math.min(100, base + jitter)))
    }
    return row
  })

  return { x_axis, y_axis: [...AMINO_ACIDS], values }
}

function makeTmbedOutput(seqLen: number): TmbedOutput {
  const labels = cycleString(REF_TMBED, seqLen)
  const probabilities: number[][] = []
  for (let r = 0; r < seqLen; r++) {
    probabilities.push([0.2, 0.2, 0.2, 0.2, 0.2])
  }
  return { labels, probabilities }
}

export function makePredictionOutputs(seqLen: number): PredictionOutputs {
  return {
    prott5_secondary_structure: {
      dssp3: cycleString(REF_DSSP3, seqLen),
      dssp8: cycleString(REF_DSSP8, seqLen),
    },
    tmbed: makeTmbedOutput(seqLen),
    seth: cycleArray(REF_DISORDER_SCORES, seqLen),
    bindembed: {
      metal: cycleString(REF_METAL, seqLen),
      nucleicAcids: cycleString(REF_NUCLEIC, seqLen),
      smallMolecules: cycleString(REF_SMALL, seqLen),
    },
    prott5_conservation: cycleArray(REF_CONSERVATION, seqLen),
    light_attention_subcellular: 'Cell membrane',
    light_attention_membrane: 'Membrane bound',
    variation: makeVariationOutput(seqLen),
  }
}

// Per-model InferResponse makers: synthesized tensors via the raw path (D-19).

/** Derive seqLen from infer request inputs. */
function deriveSeqLen(request: ModelInferRequest): number {
  const raw = request.raw_input_contents
  const inputs = request.inputs

  // prot_t5_pipeline: BYTES input — extract length from the UTF-8 payload
  if (request.model_name === 'prot_t5_pipeline') {
    if (raw?.[0] && raw[0].length >= 4) {
      const declaredLen = raw[0].readUInt32LE(0)
      if (declaredLen > 0) return declaredLen
      const totalLen = raw[0].length - 4
      return Math.max(1, totalLen)
    }
    const seq = inputs[0]?.contents.bytes_contents?.[0]?.toString('utf8') ?? ''
    return Math.max(1, seq.length)
  }

  // bind_embed: transposed input [..., 1024, seqLen] — seqLen is the last dim
  if (request.model_name === 'bind_embed') {
    const last = inputs[0]?.shape.at(-1)
    if (typeof last === 'number' && last > 0) {
      return last
    }
    if (raw?.[0]) return Math.max(1, Math.floor(raw[0].length / (1024 * 4)))
  }

  // Prediction models: FP32 embedding [seqLen, 1024]
  if (raw?.[0] && raw[0].length > 0) {
    const seqLen = Math.floor(raw[0].length / (1024 * 4))
    return Math.max(1, seqLen)
  }
  const fp32 = inputs[0]?.contents.fp32_contents
  if (fp32 && fp32.length > 0) {
    return Math.max(1, Math.floor(fp32.length / 1024))
  }
  return 10
}

function emptyContents() {
  return { fp32_contents: [], bytes_contents: [], int64_contents: [] }
}

/** prot_t5_pipeline: FP16 [seqLen, 1024] */
function makeProtT5PipelineResponse(seqLen: number): InferResponse {
  const fp16Buf = constantFp16Buffer(seqLen * 1024, 0.1)
  return {
    model_name: 'prot_t5_pipeline',
    outputs: [
      {
        name: 'embeddings',
        datatype: 'FP16',
        shape: [seqLen, 1024],
        contents: emptyContents(),
      },
    ],
    raw_output_contents: [fp16Buf],
  }
}

/** vespag: FP32 [seqLen, 20] — fixture-derived logits per D-19 */
function makeVespagResponse(seqLen: number): InferResponse {
  const values: number[] = []
  for (let r = 0; r < seqLen; r++) {
    for (let aa = 0; aa < 20; aa++) {
      // Logit at aa=0, 0 elsewhere — adapter argmax can decode
      if (aa === 0) {
        values.push(REF_VARIATION_ROW[r % REF_VARIATION_ROW.length] ?? 50)
      } else {
        values.push(0)
      }
    }
  }
  return {
    model_name: 'vespag',
    outputs: [
      {
        name: 'output',
        datatype: 'FP32',
        shape: [seqLen, 20],
        contents: emptyContents(),
      },
    ],
    raw_output_contents: [fp32Buf(values)],
  }
}

/** tmbed: labels BYTES [1] + probabilities FP32 [seqLen, 5] */
function makeTmbedResponse(seqLen: number): InferResponse {
  // BYTES with 4-byte LE length prefix
  const labelsStr = cycleString(REF_TMBED, seqLen)
  const labelsPayload = Buffer.from(labelsStr, 'utf8')
  const labelsBuf = Buffer.alloc(4 + labelsPayload.length)
  labelsBuf.writeUInt32LE(labelsPayload.length, 0)
  labelsPayload.copy(labelsBuf, 4)

  const probs = new Array<number>(seqLen * 5).fill(0.2)

  return {
    model_name: 'tmbed',
    outputs: [
      {
        name: 'labels',
        datatype: 'BYTES',
        shape: [1],
        contents: emptyContents(),
      },
      {
        name: 'probabilities',
        datatype: 'FP32',
        shape: [seqLen, 5],
        contents: emptyContents(),
      },
    ],
    raw_output_contents: [labelsBuf, fp32Buf(probs)],
  }
}

/** seth: FP32 [seqLen, 1] — REF_DISORDER_SCORES cycled */
function makeSethResponse(seqLen: number): InferResponse {
  const values: number[] = cycleArray(REF_DISORDER_SCORES, seqLen)
  return {
    model_name: 'seth',
    outputs: [
      {
        name: 'output',
        datatype: 'FP32',
        shape: [seqLen, 1],
        contents: emptyContents(),
      },
    ],
    raw_output_contents: [fp32Buf(values)],
  }
}

/** bind_embed: 5 FP32 outputs each [seqLen, 3] — synthesized logits from REF_METAL/NUCLEIC/SMALL */
function makeBindEmbedResponse(seqLen: number): InferResponse {
  const outputs: InferResponse['outputs'] = []
  const rawOutputs: Buffer[] = []

  for (let cv = 0; cv < 5; cv++) {
    const values: number[] = []
    for (let r = 0; r < seqLen; r++) {
      const m = REF_METAL[r % REF_METAL.length]
      const n = REF_NUCLEIC[r % REF_NUCLEIC.length]
      const s = REF_SMALL[r % REF_SMALL.length]
      // +5.0 → sigmoid ≈ 0.993 → mean ≈ 0.993 > 0.5 → 'b'
      // -5.0 → sigmoid ≈ 0.007 → mean ≈ 0.007 < 0.5 → '-'
      values.push(m === 'b' ? 5.0 : -5.0) // channel 0: metal
      values.push(n === 'b' ? 5.0 : -5.0) // channel 1: nucleicAcids
      values.push(s === 'b' ? 5.0 : -5.0) // channel 2: smallMolecules
    }
    outputs.push({
      name: `output_${cv.toString()}`,
      datatype: 'FP32',
      shape: [seqLen, 3],
      contents: emptyContents(),
    })
    rawOutputs.push(fp32Buf(values))
  }

  return { model_name: 'bind_embed', outputs, raw_output_contents: rawOutputs }
}

/** prott5_cons: FP32 [seqLen, 9] — one-hot logits from REF_CONSERVATION */
function makeProtT5ConsResponse(seqLen: number): InferResponse {
  const values: number[] = []
  for (let r = 0; r < seqLen; r++) {
    const classIdx = REF_CONSERVATION[r % REF_CONSERVATION.length] ?? 0
    for (let c = 0; c < 9; c++) {
      values.push(c === classIdx ? 5.0 : 0.0)
    }
  }
  return {
    model_name: 'prott5_cons',
    outputs: [
      {
        name: 'output',
        datatype: 'FP32',
        shape: [seqLen, 9],
        contents: emptyContents(),
      },
    ],
    raw_output_contents: [fp32Buf(values)],
  }
}

/** prott5_sec: d3_Yhat [seqLen,3] + d8_Yhat [seqLen,8] — one-hot logits from REF_DSSP3/DSSP8 */
function makeProtT5SecResponse(seqLen: number): InferResponse {
  const d3Values: number[] = []
  const d8Values: number[] = []

  for (let r = 0; r < seqLen; r++) {
    const ch3 = REF_DSSP3[r % REF_DSSP3.length] ?? 'C'
    const idx3 = DSSP3_LABELS.indexOf(ch3 as (typeof DSSP3_LABELS)[number])
    for (let c = 0; c < 3; c++) d3Values.push(c === idx3 ? 5.0 : 0.0)

    const ch8 = REF_DSSP8[r % REF_DSSP8.length] ?? 'C'
    const idx8 = DSSP8_LABELS.indexOf(ch8 as (typeof DSSP8_LABELS)[number])
    for (let c = 0; c < 8; c++) d8Values.push(c === idx8 ? 5.0 : 0.0)
  }

  return {
    model_name: 'prott5_sec',
    outputs: [
      {
        name: 'd3_Yhat',
        datatype: 'FP32',
        shape: [seqLen, 3],
        contents: emptyContents(),
      },
      {
        name: 'd8_Yhat',
        datatype: 'FP32',
        shape: [seqLen, 8],
        contents: emptyContents(),
      },
    ],
    raw_output_contents: [fp32Buf(d3Values), fp32Buf(d8Values)],
  }
}

/** light_attention_membrane: FP32 [2] — argmax=0 → 'Membrane bound' */
function makeLightAttentionMembraneResponse(): InferResponse {
  return {
    model_name: 'light_attention_membrane',
    outputs: [
      {
        name: 'output',
        datatype: 'FP32',
        shape: [2],
        contents: emptyContents(),
      },
    ],
    raw_output_contents: [fp32Buf([5.0, 0.0])],
  }
}

/** light_attention_subcell: FP32 [10] — argmax=1 → 'Cytoplasm' */
function makeLightAttentionSubcellResponse(): InferResponse {
  return {
    model_name: 'light_attention_subcell',
    outputs: [
      {
        name: 'output',
        datatype: 'FP32',
        shape: [10],
        contents: emptyContents(),
      },
    ],
    raw_output_contents: [
      fp32Buf([0.0, 5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
    ],
  }
}

interface ModelInferRequest {
  model_name: string
  inputs: Array<{
    name: string
    contents: {
      fp32_contents?: number[]
      bytes_contents?: Buffer[]
    }
    shape: number[]
  }>
  raw_input_contents?: Buffer[]
}

export async function startMockTritonServer(
  port: number,
): Promise<MockTritonServer> {
  const proto = getPackageDef()
  // Match client-side limits (see client.ts). grpc-js defaults cap server
  // receive at 4 MiB, which rejects prediction requests for sequences
  // ≳1024 aa (FP32 embedding = seqLen * 1024 * 4 bytes).
  const server = new grpc.Server({
    'grpc.max_receive_message_length': TRITON_MAX_MESSAGE_BYTES,
    'grpc.max_send_message_length': TRITON_MAX_MESSAGE_BYTES,
  })

  server.addService(proto.inference.GRPCInferenceService.service, {
    serverLive: (
      _: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<object>,
    ) => {
      cb(null, { live: true })
    },

    serverReady: (
      _: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<object>,
    ) => {
      cb(null, { ready: true })
    },

    // ModelReady allowlist check is case-sensitive to prevent name spoofing.
    modelReady: (
      call: grpc.ServerUnaryCall<{ name?: string; version?: string }, object>,
      cb: grpc.sendUnaryData<object>,
    ) => {
      const name = (call.request as { name?: string }).name ?? ''
      const isReady = (MOCK_READY_MODELS as readonly string[]).includes(name)
      cb(null, { ready: isReady })
    },

    modelInfer: (
      call: grpc.ServerUnaryCall<ModelInferRequest, object>,
      cb: grpc.sendUnaryData<object>,
    ) => {
      const request = call.request
      const { model_name } = request
      const seqLen = deriveSeqLen(request)

      try {
        switch (model_name) {
          case 'prot_t5_pipeline':
            cb(null, makeProtT5PipelineResponse(seqLen))
            return
          case 'vespag':
            cb(null, makeVespagResponse(seqLen))
            return
          case 'tmbed':
            cb(null, makeTmbedResponse(seqLen))
            return
          case 'seth':
            cb(null, makeSethResponse(seqLen))
            return
          case 'bind_embed':
            cb(null, makeBindEmbedResponse(seqLen))
            return
          case 'prott5_cons':
            cb(null, makeProtT5ConsResponse(seqLen))
            return
          case 'prott5_sec':
            cb(null, makeProtT5SecResponse(seqLen))
            return
          case 'light_attention_membrane':
            cb(null, makeLightAttentionMembraneResponse())
            return
          case 'light_attention_subcell':
            cb(null, makeLightAttentionSubcellResponse())
            return
          default: {
            // Unknown model_name → NOT_FOUND (code 5)
            const err = Object.assign(
              new Error(`Unknown model_name: ${model_name}`),
              { code: 5 /* grpc.status.NOT_FOUND */ },
            )
            cb(err as grpc.ServiceError, {
              model_name,
              outputs: [],
              raw_output_contents: [],
            })
            return
          }
        }
      } catch (err) {
        cb(err as grpc.ServiceError, {
          model_name,
          outputs: [],
          raw_output_contents: [],
        })
      }
    },
  })

  return new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port.toString()}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) {
          reject(err)
          return
        }
        resolve({
          stop: () => {
            server.forceShutdown()
          },
          port: boundPort,
        })
      },
    )
  })
}
