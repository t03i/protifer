import pino from 'pino'
import type { Logger } from 'pino'
import { describe, it, expect, vi } from 'vitest'

import {
  getCorrelation,
  logSubmission,
  mintRequestId,
  pinoCorrelationMixin,
  runWithCorrelation,
} from './correlation.ts'

function captureLogger(opts: pino.LoggerOptions = {}) {
  const lines: string[] = []
  const logger = pino(
    { mixin: pinoCorrelationMixin(), ...opts },
    { write: (line: string) => lines.push(line) },
  )
  const parsed = () =>
    lines.map((l) => JSON.parse(l) as Record<string, unknown>)
  return { logger, parsed }
}

describe('runWithCorrelation / getCorrelation', () => {
  it('round-trips a context inside the run scope', () => {
    expect(getCorrelation()).toBeUndefined()
    const ctx = { requestId: 'r', traceId: 't', spanId: 's' }
    const observed = runWithCorrelation(ctx, () => getCorrelation())
    expect(observed).toEqual(ctx)
    expect(getCorrelation()).toBeUndefined()
  })

  it('propagates across awaits within an async function', async () => {
    const ctx = { requestId: 'r2', traceId: 't2', spanId: 's2' }
    const observed = await runWithCorrelation(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return getCorrelation()
    })
    expect(observed).toEqual(ctx)
  })
})

describe('pinoCorrelationMixin', () => {
  it('returns an empty object when no context is active', () => {
    const mixin = pinoCorrelationMixin()
    expect(mixin()).toEqual({})
  })

  it('returns the held context object reference (no copy) when active', () => {
    const mixin = pinoCorrelationMixin()
    const ctx = { requestId: 'r3', traceId: 't3', spanId: 's3' }
    const observed = runWithCorrelation(ctx, () => mixin())
    expect(observed).toBe(ctx)
  })

  it('returns a fresh extensible empty object when no context (pino mutates it during merge)', () => {
    const mixin = pinoCorrelationMixin()
    const a = mixin()
    const b = mixin()
    expect(a).not.toBe(b)
    expect(Object.isExtensible(a)).toBe(true)
  })
})

describe('user identity in the correlation frame', () => {
  it('round-trips userId/authMethod via getCorrelation() and emits them through the mixin', () => {
    const { logger, parsed } = captureLogger()
    const ctx = {
      requestId: 'r4',
      traceId: 't4',
      spanId: 's4',
      userId: 'user-42',
      authMethod: 'session' as const,
    }
    runWithCorrelation(ctx, () => {
      expect(getCorrelation()).toBe(ctx)
      logger.info('inside frame')
    })
    const [line] = parsed()
    expect(line).toMatchObject({
      requestId: 'r4',
      userId: 'user-42',
      authMethod: 'session',
    })
  })

  it('emits neither userId nor authMethod when the frame omits them', () => {
    const { logger, parsed } = captureLogger()
    runWithCorrelation({ requestId: 'r5', traceId: 't5', spanId: 's5' }, () => {
      logger.info('no user')
    })
    const [line] = parsed()
    expect(line).toMatchObject({ requestId: 'r5' })
    expect(line).not.toHaveProperty('userId')
    expect(line).not.toHaveProperty('authMethod')
  })
})

describe('logSubmission (redaction guard)', () => {
  it('emits a single info-level line with msg "submission" and the descriptor payload, no raw sequence', () => {
    const info = vi.fn()
    const logger = { info } as unknown as Logger
    const payload = {
      userId: 'u_1',
      sequenceHash: 'sha256:deadbeef',
      seqLen: 250,
      embeddingModel: { name: 'prott5_xl_u50' as const, version: 'v1' },
      predictionModels: [{ name: 'tmbed' as const, version: 'v1' }],
      submittedAt: '2026-06-03T00:00:00.000Z',
    }
    logSubmission(logger, payload)

    expect(info).toHaveBeenCalledTimes(1)
    const [obj, msg] = info.mock.calls[0] as [Record<string, unknown>, string]
    expect(msg).toBe('submission')
    expect(obj).toMatchObject(payload)
    expect(Object.keys(obj)).toEqual(
      expect.arrayContaining([
        'userId',
        'sequenceHash',
        'seqLen',
        'embeddingModel',
        'predictionModels',
        'submittedAt',
      ]),
    )
    expect(obj).not.toHaveProperty('sequence')
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        expect(
          value.length,
          `field ${key} should be <= 256 chars (raw-sequence redaction guard)`,
        ).toBeLessThanOrEqual(256)
      }
    }
  })
})

describe('mintRequestId', () => {
  it('returns 32-char lowercase hex', () => {
    for (let i = 0; i < 16; i++) {
      const id = mintRequestId()
      expect(id).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('returns unique values', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 64; i++) ids.add(mintRequestId())
    expect(ids.size).toBe(64)
  })
})
