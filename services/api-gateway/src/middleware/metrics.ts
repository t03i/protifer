import { createMiddleware } from 'hono/factory'
import { routePath } from 'hono/route'

import type { AppMetrics } from '../metrics.ts'

export function createMetricsMiddleware(metrics: AppMetrics) {
  return createMiddleware(async (c, next) => {
    const start = process.hrtime.bigint()
    await next()
    const durationSeconds =
      Number(process.hrtime.bigint() - start) / 1_000_000_000

    const method = c.req.method
    const route = routePath(c)
    const status = String(c.res.status)

    metrics.httpRequestsTotal.inc({ method, route, status })
    metrics.httpRequestDuration.observe(
      { method, route, status },
      durationSeconds,
    )
  })
}
