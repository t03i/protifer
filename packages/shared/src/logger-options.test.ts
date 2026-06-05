import pino from 'pino'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { defaultPinoOptions } from './logger-options.ts'

const REDACTED = '[Redacted]'

let restoreNodeEnv: string | undefined

beforeEach(() => {
  // Force the production branch so defaultPinoOptions() omits the
  // pino-pretty transport (worker-thread transports can't capture in-test).
  restoreNodeEnv = process.env['NODE_ENV']
  process.env['NODE_ENV'] = 'production'
})

afterEach(() => {
  if (restoreNodeEnv === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = restoreNodeEnv
})

function captureLogger() {
  const lines: Record<string, unknown>[] = []
  const logger = pino(defaultPinoOptions(), {
    write: (l: string) => lines.push(JSON.parse(l) as Record<string, unknown>),
  })
  return { logger, lines }
}

describe('defaultPinoOptions redaction', () => {
  it.each([
    ['top-level email', { email: 'leak@example.com' }, 'email'],
    ['nested email', { user: { email: 'leak@example.com' } }, 'user'],
    [
      'top-level authorization',
      { authorization: 'Bearer xyz' },
      'authorization',
    ],
    [
      'nested authorization',
      { headers: { authorization: 'Bearer xyz' } },
      'headers',
    ],
    ['top-level ip', { ip: '203.0.113.7' }, 'ip'],
  ])('censors %s', (_name, payload, key) => {
    const { logger, lines } = captureLogger()
    logger.info(payload, 'oops')
    const [line] = lines
    const value = line?.[key]
    if (typeof value === 'object' && value !== null) {
      expect(Object.values(value)).toContain(REDACTED)
    } else {
      expect(value).toBe(REDACTED)
    }
    expect(JSON.stringify(line)).not.toContain('leak@example.com')
    expect(JSON.stringify(line)).not.toContain('Bearer xyz')
    expect(JSON.stringify(line)).not.toContain('203.0.113.7')
  })

  it('nested ip is censored', () => {
    const { logger, lines } = captureLogger()
    logger.info({ client: { ip: '203.0.113.7' } }, 'oops')
    expect((lines[0]?.['client'] as { ip: string }).ip).toBe(REDACTED)
  })

  it('leaves the submission-event shape untouched', () => {
    const { logger, lines } = captureLogger()
    const payload = {
      userId: 'u1',
      sequenceHash: 'sha256:deadbeef',
      seqLen: 250,
      embeddingModel: { name: 'prott5_xl_u50', version: 'v1' },
      predictionModels: [{ name: 'tmbed', version: 'v1' }],
      submittedAt: '2026-06-03T00:00:00.000Z',
    }
    logger.info(payload, 'submission')
    expect(lines[0]).toMatchObject(payload)
  })

  it('leaves HTTP and worker line shapes untouched', () => {
    const { logger, lines } = captureLogger()
    logger.info(
      {
        method: 'POST',
        path: '/v1/predictions',
        status: 200,
        ms: 12,
        userId: 'u1',
        authMethod: 'session',
      },
      '← response',
    )
    logger.info({ jobId: 'job-1' }, 'Processing embedding job')
    expect(lines[0]).toMatchObject({
      method: 'POST',
      path: '/v1/predictions',
      status: 200,
      userId: 'u1',
      authMethod: 'session',
    })
    expect(lines[1]).toMatchObject({ jobId: 'job-1' })
  })
})
