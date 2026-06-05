import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

import { DEFAULT_TIMEOUT_MS, withTimeout } from './_utils.ts'

/**
 * Readiness probe.
 *
 * Contrast with `/health` (liveness), which only proves the event loop is
 * serving HTTP. `/ready` verifies every hard dependency the gateway needs to
 * serve traffic — currently Redis and Postgres. If any dep is down we return
 * 503 with a per-dep breakdown so operators can see which one failed.
 *
 * k8s/compose should point **liveness** probes at `/health` and **readiness**
 * probes at `/ready`. During a dep outage the container stays alive (no
 * crash-loop) but is pulled out of the service endpoint list until it
 * recovers.
 */

export type DepStatus = 'ok' | 'down'

export interface DepCheckResult {
  status: DepStatus
  detail?: string
  ms: number
}

export interface ReadinessCheckers {
  redis: () => Promise<void>
  postgres: () => Promise<void>
  /** Optional: include only if caller wants Triton gating. */
  triton?: () => Promise<void>
  /** Overrideable for tests. Defaults to `Date.now`. */
  now?: () => number
}

async function runCheck(
  fn: () => Promise<void>,
  now: () => number,
  timeoutMs: number,
): Promise<DepCheckResult> {
  const started = now()
  try {
    await withTimeout(fn(), timeoutMs)
    return { status: 'ok', ms: now() - started }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { status: 'down', detail, ms: now() - started }
  }
}

const depResultSchema = z.object({
  status: z.enum(['ok', 'down']),
  detail: z.string().optional(),
  ms: z.number(),
})

const readyResponseSchema = z.object({
  status: z.enum(['ok', 'down']),
  timestamp: z.string(),
  checks: z.record(z.string(), depResultSchema),
})

const readyRoute = createRoute({
  method: 'get',
  path: '/',
  security: [],
  responses: {
    200: {
      content: { 'application/json': { schema: readyResponseSchema } },
      description: 'All dependencies ready',
    },
    503: {
      content: { 'application/json': { schema: readyResponseSchema } },
      description: 'At least one dependency is down',
    },
  },
})

export function createReadyRouter(checkers: ReadinessCheckers): OpenAPIHono {
  const now = checkers.now ?? Date.now
  const router = new OpenAPIHono()
  router.openapi(readyRoute, async (c) => {
    const entries: Array<[string, Promise<DepCheckResult>]> = [
      ['redis', runCheck(checkers.redis, now, DEFAULT_TIMEOUT_MS)],
      ['postgres', runCheck(checkers.postgres, now, DEFAULT_TIMEOUT_MS)],
    ]
    if (checkers.triton) {
      entries.push([
        'triton',
        runCheck(checkers.triton, now, DEFAULT_TIMEOUT_MS),
      ])
    }
    const resolved = await Promise.all(
      entries.map(async ([k, p]) => [k, await p] as const),
    )
    const checks: Record<string, DepCheckResult> = {}
    let allOk = true
    for (const [k, r] of resolved) {
      checks[k] = r
      if (r.status !== 'ok') allOk = false
    }
    return c.json(
      {
        status: allOk ? ('ok' as const) : ('down' as const),
        timestamp: new Date().toISOString(),
        checks,
      },
      allOk ? 200 : 503,
    )
  })
  return router
}
