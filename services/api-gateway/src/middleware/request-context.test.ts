import { OpenAPIHono } from '@hono/zod-openapi'
import { getCorrelation } from '@protifer/shared'
import { describe, it, expect } from 'vitest'

import { createRequestContextMiddleware } from './request-context.ts'

function buildApp(opts?: { isEnabled?: () => boolean }) {
  const app = new OpenAPIHono()
  app.use('*', createRequestContextMiddleware(opts ?? {}))
  app.get('/echo', (c) => {
    const corr = getCorrelation()
    return c.json({
      requestId: corr?.requestId ?? null,
      traceId: corr?.traceId ?? null,
      spanId: corr?.spanId ?? null,
    })
  })
  return app
}

describe('createRequestContextMiddleware', () => {
  it('mints a 32-hex request id when no inbound X-Request-Id is present', async () => {
    const app = buildApp()
    const res = await app.request('/echo')
    expect(res.status).toBe(200)
    const header = res.headers.get('X-Request-Id')
    expect(header).toMatch(/^[0-9a-f]{32}$/)
    const body = (await res.json()) as { requestId: string }
    expect(body.requestId).toBe(header)
  })

  it('adopts a valid inbound X-Request-Id verbatim', async () => {
    const app = buildApp()
    const res = await app.request('/echo', {
      headers: { 'X-Request-Id': 'my-client-trace-7' },
    })
    expect(res.headers.get('X-Request-Id')).toBe('my-client-trace-7')
    const body = (await res.json()) as { requestId: string }
    expect(body.requestId).toBe('my-client-trace-7')
  })

  it('replaces a malformed inbound X-Request-Id with a fresh mint', async () => {
    const app = buildApp()
    const cases = ['has spaces', 'a'.repeat(129), 'short', 'with/slash']
    for (const bad of cases) {
      const res = await app.request('/echo', {
        headers: { 'X-Request-Id': bad },
      })
      const header = res.headers.get('X-Request-Id')
      expect(header).not.toBe(bad)
      expect(header).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('always sets X-Request-Id on the response', async () => {
    const app = buildApp()
    const res = await app.request('/echo')
    expect(res.headers.get('X-Request-Id')).not.toBeNull()
  })

  it('exposes correlation ids inside the route handler via getCorrelation()', async () => {
    const app = buildApp()
    const res = await app.request('/echo', {
      headers: { 'X-Request-Id': 'corr-test-12345' },
    })
    const body = (await res.json()) as {
      requestId: string
      traceId: string
      spanId: string
    }
    expect(body.requestId).toBe('corr-test-12345')
    expect(body.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(body.spanId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('skips correlation on OPTIONS preflights', async () => {
    const app = buildApp()
    const res = await app.request('/echo', { method: 'OPTIONS' })
    expect(res.headers.get('X-Request-Id')).toBeNull()
  })

  it('skips correlation when isEnabled returns false', async () => {
    const app = buildApp({ isEnabled: () => false })
    const res = await app.request('/echo', {
      headers: { 'X-Request-Id': 'should-not-propagate' },
    })
    expect(res.headers.get('X-Request-Id')).toBeNull()
    const body = (await res.json()) as { requestId: string | null }
    expect(body.requestId).toBeNull()
  })
})
