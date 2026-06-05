import { PLAN_LIMITS } from '@protifer/shared'
import type { Plan } from '@protifer/shared'
import type { Context } from 'hono'

import { ACTIVE_JOBS_KEY } from '../cleanup.ts'
import type { RedisCommands } from '../queue.ts'

/** Hard cap (ms) so a hung dependency can't pin a health/readiness probe. */
export const DEFAULT_TIMEOUT_MS = 2_000

/**
 * Concurrent-job admission guard shared by the prediction + embedding submit
 * routes. Returns `true` when the caller is within their plan's concurrency
 * cap. When at/over the cap it sets the `X-RateLimit-Concurrent` header on `c`
 * and returns `false`; the caller emits the 429 body (typed per route).
 */
export async function withinConcurrentJobLimit(
  c: Context,
  redis: RedisCommands,
  auth: { sub: string; plan: Plan },
): Promise<boolean> {
  const concurrentCount = await redis.zcard(ACTIVE_JOBS_KEY(auth.sub))
  const { maxConcurrentJobs } = PLAN_LIMITS[auth.plan]
  if (concurrentCount >= maxConcurrentJobs) {
    c.header('X-RateLimit-Concurrent', String(concurrentCount))
    return false
  }
  return true
}

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => {
      reject(new Error(`timeout after ${String(ms)}ms`))
    }, ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (t) clearTimeout(t)
  }
}
