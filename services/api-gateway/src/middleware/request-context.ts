import { trace } from '@opentelemetry/api'
import { mintRequestId, runWithCorrelation } from '@protifer/shared'
import * as Sentry from '@sentry/node'
import { createMiddleware } from 'hono/factory'
import { routePath } from 'hono/route'

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/

export interface RequestContextOptions {
  isEnabled?: () => Promise<boolean> | boolean
}

export function createRequestContextMiddleware(
  opts: RequestContextOptions = {},
) {
  return createMiddleware(async (c, next) => {
    if (opts.isEnabled) {
      const enabled = await opts.isEnabled()
      if (!enabled) {
        await next()
        return
      }
    }

    // CORS preflights don't need correlation — skip the Sentry span + ALS frame.
    if (c.req.method === 'OPTIONS') {
      await next()
      return
    }

    const inbound = c.req.header('X-Request-Id')
    const requestId =
      inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : mintRequestId()

    const method = c.req.method
    const route = routePath(c)

    await Sentry.startSpan(
      { name: `http.${method} ${route}`, op: 'http.server' },
      async (span) => {
        const active = trace.getActiveSpan()
        const ctx = active?.spanContext()
        // No DSN → no OTel context → fallback ids are for log correlation only,
        // not for lookup in a tracing backend.
        const traceId = ctx?.traceId ?? mintRequestId()
        const spanId = ctx?.spanId ?? '0'.repeat(16)

        span.setAttribute('http.method', method)
        span.setAttribute('http.route', route)
        span.setAttribute('request.id', requestId)

        try {
          await runWithCorrelation({ requestId, traceId, spanId }, async () => {
            await next()
          })
        } finally {
          span.setAttribute('http.status_code', c.res.status)
          c.res.headers.set('X-Request-Id', requestId)
        }
      },
    )
  })
}
