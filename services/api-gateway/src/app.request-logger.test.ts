import type { AuthContext } from '@protifer/shared'
import {
  getCorrelation,
  pinoCorrelationMixin,
  runWithCorrelation,
} from '@protifer/shared'
import { Hono } from 'hono'
import pino from 'pino'
import { describe, it, expect } from 'vitest'

import { createRequestLogger } from './app.ts'
import { createUserContextMiddleware } from './middleware/user-context.ts'
import type { Variables } from './types/hono.ts'

const AUTH: AuthContext = {
  sub: 'user-42',
  email: 'u42@example.com',
  plan: 'free',
  method: 'api-key',
}

// Mirrors the real mount order: request-context frame → request logger →
// authenticate (faked) → user-context → handler.
function buildApp(opts: { auth?: AuthContext }) {
  const lines: Record<string, unknown>[] = []
  const logger = pino(
    { mixin: pinoCorrelationMixin() },
    {
      write: (l: string) =>
        lines.push(JSON.parse(l) as Record<string, unknown>),
    },
  )
  const app = new Hono<{ Variables: Variables }>()
  app.use('*', async (_c, next) => {
    await runWithCorrelation(
      { requestId: 'r1', traceId: 't1', spanId: 's1' },
      next,
    )
  })
  app.use('*', createRequestLogger(logger))
  if (opts.auth) {
    const auth = opts.auth
    app.use('*', async (c, next) => {
      c.set('auth', auth)
      await next()
    })
  }
  app.use('*', createUserContextMiddleware())
  app.get('/echo', (c) => {
    logger.info('handler line')
    return c.json(getCorrelation() ?? null)
  })
  return { app, lines }
}

function lineFor(lines: Record<string, unknown>[], msg: string) {
  const line = lines.find((l) => l['msg'] === msg)
  expect(line, `expected a "${msg}" line`).toBeDefined()
  return line as Record<string, unknown>
}

describe('createRequestLogger user attribution', () => {
  it('← response carries userId/authMethod for an authenticated request', async () => {
    const { app, lines } = buildApp({ auth: AUTH })
    const res = await app.request('/echo')
    expect(res.status).toBe(200)

    const response = lineFor(lines, '← response')
    expect(response['userId']).toBe('user-42')
    expect(response['authMethod']).toBe('api-key')
    expect(response['requestId']).toBe('r1')
  })

  it('handler-emitted lines carry userId via the mixin, → request does not', async () => {
    const { app, lines } = buildApp({ auth: AUTH })
    await app.request('/echo')

    const handler = lineFor(lines, 'handler line')
    expect(handler['userId']).toBe('user-42')
    expect(handler['authMethod']).toBe('api-key')

    const request = lineFor(lines, '→ request')
    expect(request).not.toHaveProperty('userId')
    expect(request).not.toHaveProperty('authMethod')
  })

  it('← response carries neither field for an unauthenticated request', async () => {
    const { app, lines } = buildApp({})
    await app.request('/echo')

    const response = lineFor(lines, '← response')
    expect(response).not.toHaveProperty('userId')
    expect(response).not.toHaveProperty('authMethod')
    expect(response['requestId']).toBe('r1')
  })
})
