/**
 * Tests dev-only docs and security response headers in isolation. Reproduces
 * the middleware composition from `app.ts` against a minimal app rather than
 * booting the full `createApp` graph (which needs Postgres/Redis/BullMQ).
 */

import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import { describe, it, expect } from 'vitest'

/**
 * Mirrors the secureHeaders + dev-only docs wiring in `createApp`
 * (services/api-gateway/src/app.ts). Kept in sync with that file — if the
 * policy there changes, these assertions should be updated alongside it.
 */
function buildTestApp({ isProduction }: { isProduction: boolean }) {
  const app = new OpenAPIHono()

  const strictSecureHeaders = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
    strictTransportSecurity: false,
  })
  app.use(
    '*',
    createMiddleware<{ Variables: Record<string, never> }>(async (c, next) => {
      if (c.req.path === '/docs') {
        await next()
        return
      }
      await strictSecureHeaders(c, next)
    }),
  )

  app.get('/health', (c) => c.json({ ok: true }))

  if (!isProduction) {
    app.doc('/openapi.json', {
      openapi: '3.0.0',
      info: { title: 'test', version: '0.0.0' },
    })
    app.use(
      '/docs',
      secureHeaders({
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
        xFrameOptions: 'DENY',
        referrerPolicy: 'no-referrer',
        strictTransportSecurity: false,
      }),
    )
    app.get('/docs', swaggerUI({ url: '/openapi.json' }))
  }

  return app
}

describe('P3-09 — security response headers', () => {
  it('emits strict CSP / X-Frame-Options / Referrer-Policy on API responses', async () => {
    const app = buildTestApp({ isProduction: true })
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    )
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('does NOT emit Strict-Transport-Security (Caddy owns HSTS in prod)', async () => {
    const app = buildTestApp({ isProduction: true })
    const res = await app.request('/health')
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })

  it('relaxes CSP for /docs so Swagger UI inline scripts/styles work in dev', async () => {
    const app = buildTestApp({ isProduction: false })
    const res = await app.request('/docs')

    expect(res.status).toBe(200)
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    // X-Frame-Options / Referrer-Policy stay strict even on /docs.
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })
})

describe('P3-06 — Swagger UI and OpenAPI spec are dev-only', () => {
  it('returns 404 for /docs when NODE_ENV=production', async () => {
    const app = buildTestApp({ isProduction: true })
    const res = await app.request('/docs')
    expect(res.status).toBe(404)
  })

  it('returns 404 for /openapi.json when NODE_ENV=production', async () => {
    const app = buildTestApp({ isProduction: true })
    const res = await app.request('/openapi.json')
    expect(res.status).toBe(404)
  })

  it('serves /docs and /openapi.json in non-production', async () => {
    const app = buildTestApp({ isProduction: false })
    expect((await app.request('/docs')).status).toBe(200)
    expect((await app.request('/openapi.json')).status).toBe(200)
  })
})
