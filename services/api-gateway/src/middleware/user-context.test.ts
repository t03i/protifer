import type { AuthContext, CorrelationContext } from '@protifer/shared'
import { getCorrelation, runWithCorrelation } from '@protifer/shared'
import * as Sentry from '@sentry/node'
import { Hono } from 'hono'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { createUserContextMiddleware } from './user-context.ts'
import type { Variables } from '../types/hono.ts'

vi.mock('@sentry/node', () => ({
  setUser: vi.fn(),
}))

const AUTH: AuthContext = {
  sub: 'user-42',
  email: 'u42@example.com',
  plan: 'pro',
  method: 'session',
}

function buildApp(opts: { auth?: AuthContext; frame?: CorrelationContext }) {
  const app = new Hono<{ Variables: Variables }>()
  if (opts.frame) {
    const frame = opts.frame
    app.use('*', async (_c, next) => {
      await runWithCorrelation(frame, next)
    })
  }
  if (opts.auth) {
    const auth = opts.auth
    app.use('*', async (c, next) => {
      c.set('auth', auth)
      await next()
    })
  }
  app.use('*', createUserContextMiddleware())
  app.get('/echo', (c) => c.json(getCorrelation() ?? null))
  return app
}

const FRAME: CorrelationContext = {
  requestId: 'r1',
  traceId: 't1',
  spanId: 's1',
}

beforeEach(() => {
  vi.mocked(Sentry.setUser).mockClear()
})

describe('createUserContextMiddleware', () => {
  it('enriches the frame with userId and authMethod for downstream handlers', async () => {
    const app = buildApp({ auth: AUTH, frame: { ...FRAME } })
    const res = await app.request('/echo')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      requestId: 'r1',
      traceId: 't1',
      spanId: 's1',
      userId: 'user-42',
      authMethod: 'session',
    })
  })

  it('never mutates the outer frame object', async () => {
    const outer = { ...FRAME }
    const app = buildApp({ auth: AUTH, frame: outer })
    await app.request('/echo')
    expect(outer).toEqual(FRAME)
    expect(outer).not.toHaveProperty('userId')
    expect(outer).not.toHaveProperty('authMethod')
  })

  it('never copies email/plan/role into the frame', async () => {
    const app = buildApp({
      auth: { ...AUTH, role: 'admin' },
      frame: { ...FRAME },
    })
    const res = await app.request('/echo')
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      'authMethod',
      'requestId',
      'spanId',
      'traceId',
      'userId',
    ])
  })

  it('passes through when no auth is set', async () => {
    const app = buildApp({ frame: { ...FRAME } })
    const res = await app.request('/echo')
    expect(await res.json()).toEqual(FRAME)
    expect(Sentry.setUser).not.toHaveBeenCalled()
  })

  it('passes through without creating a frame when no correlation frame is active', async () => {
    const app = buildApp({ auth: AUTH })
    const res = await app.request('/echo')
    expect(await res.json()).toBeNull()
    expect(Sentry.setUser).not.toHaveBeenCalled()
  })

  it('calls Sentry.setUser with the id only', async () => {
    const app = buildApp({ auth: AUTH, frame: { ...FRAME } })
    await app.request('/echo')
    expect(Sentry.setUser).toHaveBeenCalledTimes(1)
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-42' })
  })

  it('carries the bearer-verified method as api-key', async () => {
    const app = buildApp({
      auth: { ...AUTH, method: 'api-key' },
      frame: { ...FRAME },
    })
    const res = await app.request('/echo')
    const body = (await res.json()) as { authMethod: string }
    expect(body.authMethod).toBe('api-key')
  })
})
