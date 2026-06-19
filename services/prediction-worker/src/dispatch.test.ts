import { createWorkerMetrics } from '@protifer/shared'
import type { TritonClient, InferResponse } from '@protifer/triton-client'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ShapeError, DtypeError, DecodeError } from './adapters/errors.ts'
import type { AdapterContext } from './adapters/types.ts'
import { classifyError, dispatchAll } from './dispatch.ts'
import { createSemaphore } from './semaphore.ts'

type StubBehavior =
  | { mode: 'succeed'; result: unknown }
  | { mode: 'throw-grpc'; code: number; message: string }
  | { mode: 'throw-adapter'; err: Error }
  | { mode: 'throw-generic'; err: unknown }

function makeStubAdapter(outputKey: string, behavior: StubBehavior) {
  return {
    modelName: `mock_${outputKey}`,
    outputKey,
    buildRequest: vi.fn().mockImplementation(() => ({
      model_name: `mock_${outputKey}`,
      inputs: [],
      outputs: [],
    })),
    decodeResponse: vi.fn().mockImplementation((): unknown => {
      if (behavior.mode === 'succeed') return behavior.result
      if (behavior.mode === 'throw-grpc') {
        const err = Object.assign(new Error(behavior.message), {
          code: behavior.code,
        })
        throw err
      }
      if (behavior.mode === 'throw-adapter') throw behavior.err
      throw behavior.err
    }),
  }
}

// Mock ADAPTER_REGISTRY via a mutable holder so each test can set its content.
const registryHolder: Record<string, ReturnType<typeof makeStubAdapter>> = {}

vi.mock('./adapters/index.ts', () => ({
  get ADAPTER_REGISTRY() {
    return registryHolder
  },
}))

const EIGHT_KEYS = [
  'prott5_secondary_structure',
  'tmbed',
  'seth',
  'bindembed',
  'prott5_conservation',
  'variation',
  'light_attention_subcellular',
  'light_attention_membrane',
]

function makeTriton(inferResult?: InferResponse): TritonClient {
  return {
    modelInfer: vi.fn().mockResolvedValue(
      inferResult ?? {
        model_name: '',
        outputs: [],
        raw_output_contents: [],
      },
    ),
    serverReady: vi.fn().mockResolvedValue(true),
    modelReady: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  } as unknown as TritonClient
}

const CTX: AdapterContext = {
  embeddingFp32: new Float32Array(10 * 1024),
  mask: new Float32Array(10).fill(1),
  seqLen: 10,
  sequence: 'MKTVRQERLK',
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Triton stub whose modelInfer blocks until explicitly released, tracking concurrency. */
function makeGatedTriton() {
  let inFlight = 0
  let maxInFlight = 0
  const pending: Array<() => void> = []
  const modelInfer = vi.fn().mockImplementation(
    () =>
      new Promise<InferResponse>((resolve) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        pending.push(() => {
          inFlight--
          resolve({ model_name: '', outputs: [], raw_output_contents: [] })
        })
      }),
  )
  const triton = {
    modelInfer,
    serverReady: vi.fn().mockResolvedValue(true),
    modelReady: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  } as unknown as TritonClient
  return {
    triton,
    modelInfer,
    get inFlight() {
      return inFlight
    },
    get maxInFlight() {
      return maxInFlight
    },
    get pendingCount() {
      return pending.length
    },
    releaseOne() {
      pending.shift()?.()
    },
  }
}

function fillRegistry(behaviors: StubBehavior[]) {
  for (const k of Object.keys(registryHolder)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete registryHolder[k]
  }
  EIGHT_KEYS.forEach((key, i) => {
    registryHolder[key] = makeStubAdapter(
      key,
      behaviors[i] ?? { mode: 'succeed', result: {} },
    )
  })
}

describe('classifyError', () => {
  it('maps gRPC code 14 → UNAVAILABLE', () => {
    const result = classifyError({ code: 14, message: 'up' })
    expect(result).toEqual({ code: 'UNAVAILABLE', message: 'up' })
  })

  it('maps gRPC code 4 → DEADLINE_EXCEEDED', () => {
    const result = classifyError({ code: 4, message: 'dd' })
    expect(result).toEqual({ code: 'DEADLINE_EXCEEDED', message: 'dd' })
  })

  it('maps gRPC code 3 → INVALID_ARGUMENT', () => {
    const result = classifyError({ code: 3, message: 'bad arg' })
    expect(result).toEqual({ code: 'INVALID_ARGUMENT', message: 'bad arg' })
  })

  it('maps gRPC code 5 → NOT_FOUND', () => {
    const result = classifyError({ code: 5, message: 'not found' })
    expect(result).toEqual({ code: 'NOT_FOUND', message: 'not found' })
  })

  it('maps gRPC code 13 → INTERNAL', () => {
    const result = classifyError({ code: 13, message: 'oops' })
    expect(result).toEqual({ code: 'INTERNAL', message: 'oops' })
  })

  it('maps unknown gRPC code 99 → INTERNAL', () => {
    const result = classifyError({ code: 99 })
    expect(result.code).toBe('INTERNAL')
  })

  it('maps ShapeError → SHAPE_MISMATCH', () => {
    const result = classifyError(new ShapeError('bad'))
    expect(result).toEqual({ code: 'SHAPE_MISMATCH', message: 'bad' })
  })

  it('maps DtypeError → DTYPE_MISMATCH', () => {
    const result = classifyError(new DtypeError('dt'))
    expect(result).toEqual({ code: 'DTYPE_MISMATCH', message: 'dt' })
  })

  it('maps DecodeError → DECODE_ERROR', () => {
    const result = classifyError(new DecodeError('dc'))
    expect(result).toEqual({ code: 'DECODE_ERROR', message: 'dc' })
  })

  it('maps generic Error → DECODE_ERROR', () => {
    const result = classifyError(new Error('generic'))
    expect(result.code).toBe('DECODE_ERROR')
  })

  it('maps raw string → DECODE_ERROR with original text', () => {
    const result = classifyError('raw string')
    expect(result).toEqual({ code: 'DECODE_ERROR', message: 'raw string' })
  })

  it('truncates message longer than 200 chars to exactly 200 chars', () => {
    const long = 'x'.repeat(500)
    const result = classifyError(new Error(long))
    expect(result.message.length).toBe(200)
    expect(result.code).toBe('DECODE_ERROR')
  })

  it('truncates gRPC message longer than 200 chars to exactly 200 chars', () => {
    const long = 'y'.repeat(500)
    const result = classifyError({ code: 14, message: long })
    expect(result.message.length).toBe(200)
  })

  it('does not include stack trace content in classified message', () => {
    // A thrown Error has a .stack; classifyError must only use .message
    const err = new Error('runtime failure')
    const result = classifyError(err)
    // Stack trace lines look like "at Object.<anonymous> (file.ts:1:1)"
    expect(/at .+\.ts:\d+/.test(result.message)).toBe(false)
    expect(/at .+\.js:\d+/.test(result.message)).toBe(false)
  })

  it('string-typed .code does not enter gRPC branch (T-21-04-05)', () => {
    // An object with a string .code must NOT map to UNAVAILABLE — falls to DECODE_ERROR
    const result = classifyError({ code: '14', message: 'spoofed' })
    // Should fall through to generic Error or string branch → DECODE_ERROR, not UNAVAILABLE
    expect(result.code).not.toBe('UNAVAILABLE')
  })
})

describe('dispatchAll', () => {
  beforeEach(() => {
    fillRegistry(
      EIGHT_KEYS.map(() => ({
        mode: 'succeed' as const,
        result: { ok: true },
      })),
    )
  })

  it('all 8 adapters succeed → outputs has 8 keys, modelErrors is empty', async () => {
    const triton = makeTriton()
    const { outputs, modelErrors } = await dispatchAll(triton, CTX)
    expect(Object.keys(outputs).length).toBe(8)
    expect(Object.keys(modelErrors).length).toBe(0)
  })

  it('5 succeed + 3 fail with gRPC codes → outputs has 5 keys, modelErrors has 3 with correct codes', async () => {
    const behaviors: StubBehavior[] = [
      {
        mode: 'succeed',
        result: { dssp3: 'C'.repeat(10), dssp8: 'C'.repeat(10) },
      },
      { mode: 'succeed', result: 'i'.repeat(10) },
      { mode: 'succeed', result: new Array(10).fill(0.05) },
      {
        mode: 'succeed',
        result: {
          metal: '-'.repeat(10),
          nucleicAcids: '-'.repeat(10),
          smallMolecules: '-'.repeat(10),
        },
      },
      { mode: 'succeed', result: new Array(10).fill(3) },
      // Three failures with distinct gRPC codes
      { mode: 'throw-grpc', code: 14, message: 'up' }, // variation → UNAVAILABLE
      { mode: 'throw-grpc', code: 4, message: 'dd' }, // light_attention_subcellular → DEADLINE_EXCEEDED
      { mode: 'throw-grpc', code: 13, message: 'oops' }, // light_attention_membrane → INTERNAL
    ]
    fillRegistry(behaviors)

    const triton = makeTriton()
    const { outputs, modelErrors } = await dispatchAll(triton, CTX)

    expect(Object.keys(outputs).length).toBe(5)
    expect(Object.keys(modelErrors).length).toBe(3)

    expect(modelErrors['variation']?.code).toBe('UNAVAILABLE')
    expect(modelErrors['light_attention_subcellular']?.code).toBe(
      'DEADLINE_EXCEEDED',
    )
    expect(modelErrors['light_attention_membrane']?.code).toBe('INTERNAL')
  })

  it('all 8 fail → outputs is empty object, modelErrors has 8 keys', async () => {
    const codes = [14, 4, 13, 3, 5, 14, 4, 13]
    const behaviors: StubBehavior[] = EIGHT_KEYS.map((_, i) => ({
      mode: 'throw-grpc' as const,
      code: codes[i] ?? 14,
      message: `error ${String(i)}`,
    }))
    fillRegistry(behaviors)

    const triton = makeTriton()
    const { outputs, modelErrors } = await dispatchAll(triton, CTX)

    expect(Object.keys(outputs).length).toBe(0)
    expect(Object.keys(modelErrors).length).toBe(8)
  })

  it('all modelErrors entries have ISO8601 failedAt timestamp', async () => {
    const behaviors: StubBehavior[] = EIGHT_KEYS.map(() => ({
      mode: 'throw-grpc' as const,
      code: 14,
      message: 'fail',
    }))
    fillRegistry(behaviors)

    const triton = makeTriton()
    const { modelErrors } = await dispatchAll(triton, CTX)

    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    for (const entry of Object.values(modelErrors)) {
      expect(ISO_RE.test(entry.failedAt)).toBe(true)
    }
  })

  it('modelErrors message never contains JS stack trace lines', async () => {
    const behaviors: StubBehavior[] = EIGHT_KEYS.map(() => ({
      mode: 'throw-adapter' as const,
      err: new Error('runtime failure inside adapter'),
    }))
    fillRegistry(behaviors)

    const triton = makeTriton()
    const { modelErrors } = await dispatchAll(triton, CTX)

    const STACK_RE = /at .+\.(ts|js):\d+/
    for (const entry of Object.values(modelErrors)) {
      expect(STACK_RE.test(entry.message)).toBe(false)
    }
  })

  it('1 adapter succeeds when others fail → dispatchAll returns normally (partial success)', async () => {
    const behaviors: StubBehavior[] = EIGHT_KEYS.map((_, i) =>
      i === 0
        ? { mode: 'succeed' as const, result: { dssp3: 'H', dssp8: 'H' } }
        : { mode: 'throw-grpc' as const, code: 14, message: 'unavail' },
    )
    fillRegistry(behaviors)

    const triton = makeTriton()
    // Should NOT throw — partial success is returned normally
    const { outputs, modelErrors } = await dispatchAll(triton, CTX)

    expect(Object.keys(outputs).length).toBe(1)
    expect(Object.keys(modelErrors).length).toBe(7)
  })

  it('records per-model success observation when metrics provided', async () => {
    const metrics = createWorkerMetrics()
    const triton = makeTriton()
    await dispatchAll(triton, CTX, { metrics })

    const text = await metrics.registry.metrics()
    expect(text).toContain(
      'triton_model_infer_duration_seconds_count{model="mock_tmbed",status="success"}',
    )
  })

  it('records a non-success status for a failing model (code 14 → UNAVAILABLE)', async () => {
    const behaviors: StubBehavior[] = EIGHT_KEYS.map((_, i) =>
      i === 1
        ? { mode: 'throw-grpc' as const, code: 14, message: 'down' }
        : { mode: 'succeed' as const, result: {} },
    )
    fillRegistry(behaviors)

    const metrics = createWorkerMetrics()
    const triton = makeTriton()
    await dispatchAll(triton, CTX, { metrics })

    const text = await metrics.registry.metrics()
    expect(text).toContain(
      'triton_model_infer_duration_seconds_count{model="mock_tmbed",status="UNAVAILABLE"}',
    )
  })

  it('records per-model failure observations when all models fail', async () => {
    const behaviors: StubBehavior[] = EIGHT_KEYS.map(() => ({
      mode: 'throw-grpc' as const,
      code: 14,
      message: 'down',
    }))
    fillRegistry(behaviors)

    const metrics = createWorkerMetrics()
    const triton = makeTriton()
    await dispatchAll(triton, CTX, { metrics })

    const text = await metrics.registry.metrics()
    const failureLines = text
      .split('\n')
      .filter(
        (l) =>
          l.startsWith('triton_model_infer_duration_seconds_count') &&
          l.includes('status="UNAVAILABLE"') &&
          l.endsWith(' 1'),
      )
    expect(failureLines.length).toBe(EIGHT_KEYS.length)
  })

  it('ShapeError adapter → modelErrors entry has code SHAPE_MISMATCH', async () => {
    const behaviors: StubBehavior[] = EIGHT_KEYS.map((_, i) =>
      i === 2
        ? { mode: 'throw-adapter' as const, err: new ShapeError('wrong shape') }
        : { mode: 'succeed' as const, result: {} },
    )
    fillRegistry(behaviors)

    const triton = makeTriton()
    const { modelErrors } = await dispatchAll(triton, CTX)

    // EIGHT_KEYS[2] is 'seth'
    expect(modelErrors['seth']?.code).toBe('SHAPE_MISMATCH')
    expect(modelErrors['seth']?.message).toBe('wrong shape')
  })
})

describe('dispatchAll concurrency bound', () => {
  beforeEach(() => {
    fillRegistry(
      EIGHT_KEYS.map(() => ({
        mode: 'succeed' as const,
        result: { ok: true },
      })),
    )
  })

  it('never exceeds the limit across simultaneous dispatchAll invocations', async () => {
    const sem = createSemaphore(2)
    const gated = makeGatedTriton()

    const p1 = dispatchAll(gated.triton, CTX, { semaphore: sem })
    const p2 = dispatchAll(gated.triton, CTX, { semaphore: sem })

    await flush()
    expect(gated.inFlight).toBe(2)

    while (gated.pendingCount > 0) {
      gated.releaseOne()
      await flush()
    }
    await Promise.all([p1, p2])

    expect(gated.maxInFlight).toBe(2)
    expect(sem.available).toBe(2)
  })

  it('releases a permit when modelInfer throws (no leak)', async () => {
    const sem = createSemaphore(4)
    const triton = {
      modelInfer: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('down'), { code: 14 })),
      serverReady: vi.fn().mockResolvedValue(true),
      modelReady: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    } as unknown as TritonClient

    const { outputs, modelErrors } = await dispatchAll(triton, CTX, {
      semaphore: sem,
    })

    expect(Object.keys(outputs).length).toBe(0)
    expect(Object.keys(modelErrors).length).toBe(8)
    expect(sem.available).toBe(4)
  })

  it('makes excess calls wait rather than opening immediately', async () => {
    const sem = createSemaphore(3)
    const gated = makeGatedTriton()

    const p = dispatchAll(gated.triton, CTX, { semaphore: sem })
    await flush()

    expect(gated.modelInfer).toHaveBeenCalledTimes(3)
    expect(gated.inFlight).toBe(3)

    while (gated.pendingCount > 0) {
      gated.releaseOne()
      await flush()
    }
    await p

    expect(gated.modelInfer).toHaveBeenCalledTimes(8)
  })
})
