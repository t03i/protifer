import { OpenAPIHono } from '@hono/zod-openapi'
import type { AuthContext, Redis } from '@protifer/shared'
import { PLAN_LIMITS } from '@protifer/shared'
import RedisMock from 'ioredis-mock'
import { describe, it, expect, beforeEach } from 'vitest'

import {
  createSubmissionRateLimiter,
  createPollRateLimiter,
} from './rate-limit.ts'
import type { Variables } from '../types/hono.ts'

// rate-limit-redis uses SCRIPT LOAD + EVALSHA for atomic counting. ioredis-mock
// does not implement them, so we re-execute the two known scripts in JS over
// the mock's plain commands. This keeps us honest about the surface that
// rate-limit-redis actually calls (SET / INCR / PEXPIRE / GET / PTTL).
function patchMockForScripts(client: RedisMock): Redis {
  const scripts = new Map<string, 'increment' | 'get'>()
  const INCREMENT_SHA = 'increment-script-sha'
  const GET_SHA = 'get-script-sha'

  const anyClient = client as unknown as Record<string, unknown>
  anyClient['script'] = ((subcommand: string, source: string) => {
    if (subcommand.toLowerCase() !== 'load') {
      throw new Error(`unexpected SCRIPT ${subcommand}`)
    }
    const kind = source.includes('INCR')
      ? 'increment'
      : source.includes('GET')
        ? 'get'
        : null
    if (!kind) throw new Error('unknown script')
    const sha = kind === 'increment' ? INCREMENT_SHA : GET_SHA
    scripts.set(sha, kind)
    return Promise.resolve(sha)
  }) as unknown

  anyClient['evalsha'] = (async (
    sha: string,
    _numKeys: string | number,
    key: string,
    ...argv: string[]
  ) => {
    const kind = scripts.get(sha)
    if (!kind) throw new Error(`unknown evalsha ${sha}`)

    if (kind === 'increment') {
      const windowMs = Number(argv[1])
      const pttl = await (client as unknown as Redis).pttl(key)
      if (pttl <= 0) {
        await (client as unknown as Redis).set(key, '1', 'PX', windowMs)
        return [1, windowMs]
      }
      const hits = await (client as unknown as Redis).incr(key)
      return [hits, pttl]
    }
    const totalHits = await (client as unknown as Redis).get(key)
    const timeToExpire = await (client as unknown as Redis).pttl(key)
    return [totalHits ?? false, timeToExpire]
  }) as unknown

  return client as unknown as Redis
}

let connection: Redis

beforeEach(async () => {
  const RedisCtor = RedisMock as unknown as new () => RedisMock
  connection = patchMockForScripts(new RedisCtor())
  // ioredis-mock shares its keyspace across instances unless explicitly
  // flushed — wipe it so test order cannot leak rate-limit counters.
  await (
    connection as unknown as { flushall: () => Promise<unknown> }
  ).flushall()
})

function makeAuthApp(
  plan: AuthContext['plan'],
  rateLimiter: ReturnType<typeof createSubmissionRateLimiter>,
) {
  const app = new OpenAPIHono<{ Variables: Variables }>()
  app.use('*', (c, next) => {
    c.set('auth', { sub: 'user-001', email: 'u@test.com', plan })
    return next()
  })
  app.use('*', rateLimiter)
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

describe('createSubmissionRateLimiter', () => {
  it('allows requests within limit', async () => {
    const app = makeAuthApp('free', createSubmissionRateLimiter({ connection }))
    const res = await app.request('/test')
    expect(res.status).toBe(200)
  })

  it('includes draft-7 rate limit headers', async () => {
    const app = makeAuthApp('free', createSubmissionRateLimiter({ connection }))
    const res = await app.request('/test')
    expect(res.headers.get('ratelimit')).toBeDefined()
    expect(res.headers.get('ratelimit-policy')).toBeDefined()
  })

  it('enforces free plan limit in headers', async () => {
    const app = makeAuthApp('free', createSubmissionRateLimiter({ connection }))
    const res = await app.request('/test')
    expect(res.headers.get('ratelimit-policy')).toContain(
      String(PLAN_LIMITS.free.submissionsPerMinute),
    )
  })

  it('enforces pro plan limit in headers', async () => {
    const app = makeAuthApp('pro', createSubmissionRateLimiter({ connection }))
    const res = await app.request('/test')
    expect(res.headers.get('ratelimit-policy')).toContain(
      String(PLAN_LIMITS.pro.submissionsPerMinute),
    )
  })

  it('enforces enterprise plan limit in headers', async () => {
    const app = makeAuthApp(
      'enterprise',
      createSubmissionRateLimiter({ connection }),
    )
    const res = await app.request('/test')
    expect(res.headers.get('ratelimit-policy')).toContain(
      String(PLAN_LIMITS.enterprise.submissionsPerMinute),
    )
  })

  it('honors a configured per-plan submissions ceiling', async () => {
    const app = makeAuthApp(
      'free',
      createSubmissionRateLimiter({
        connection,
        submissionsPerMinute: { free: 999, pro: 60, enterprise: 300 },
      }),
    )
    const res = await app.request('/test')
    expect(res.headers.get('ratelimit-policy')).toContain('999')
  })

  it('shares counter across two limiter instances on the same connection', async () => {
    const limiterA = createSubmissionRateLimiter({ connection })
    const limiterB = createSubmissionRateLimiter({ connection })

    const appA = makeAuthApp('free', limiterA)
    const appB = makeAuthApp('free', limiterB)

    const a = await appA.request('/test')
    const b = await appB.request('/test')
    const parseRemaining = (h: string | null) => {
      const m = /remaining=(\d+)/.exec(h ?? '')
      return m ? Number(m[1]) : null
    }
    const remainingA = parseRemaining(a.headers.get('ratelimit'))
    const remainingB = parseRemaining(b.headers.get('ratelimit'))
    expect(remainingA).not.toBeNull()
    expect(remainingB).not.toBeNull()
    expect(remainingB).toBeLessThan(remainingA as number)
  })

  it('returns 429 with numeric Retry-After once the limit is exceeded', async () => {
    const limit = PLAN_LIMITS.free.submissionsPerMinute
    const app = makeAuthApp('free', createSubmissionRateLimiter({ connection }))

    // Fire exactly `limit` requests — all must succeed.
    for (let i = 0; i < limit; i++) {
      const res = await app.request('/test')
      expect(res.status).toBe(200)
    }

    // The next request is over the limit.
    const blocked = await app.request('/test')
    expect(blocked.status).toBe(429)

    const retryAfter = blocked.headers.get('retry-after')
    expect(retryAfter).not.toBeNull()
    const seconds = Number(retryAfter)
    expect(Number.isFinite(seconds)).toBe(true)
    // 60s window: Retry-After should be in (0, 60].
    expect(seconds).toBeGreaterThan(0)
    expect(seconds).toBeLessThanOrEqual(60)
  })

  it('resets the counter after the window elapses', async () => {
    const limit = PLAN_LIMITS.free.submissionsPerMinute
    const app = makeAuthApp('free', createSubmissionRateLimiter({ connection }))

    for (let i = 0; i < limit; i++) {
      await app.request('/test')
    }
    const blocked = await app.request('/test')
    expect(blocked.status).toBe(429)

    // Flush the rate-limit keys to simulate the window elapsing. The patched
    // mock uses PX/PTTL under the hood; deleting the key is the cleanest way
    // to roll forward without depending on vitest fake timers interacting
    // with ioredis-mock's internal setTimeout handles.
    const anyClient = connection as unknown as {
      keys: (pattern: string) => Promise<string[]>
      del: (...keys: string[]) => Promise<number>
    }
    const keys = await anyClient.keys('rl:submit:*')
    if (keys.length > 0) await anyClient.del(...keys)

    const recovered = await app.request('/test')
    expect(recovered.status).toBe(200)
  })
})

describe('PLAN_LIMITS', () => {
  it('free plan has 10 submissions per minute', () => {
    expect(PLAN_LIMITS.free.submissionsPerMinute).toBe(10)
  })

  it('pro plan has 60 submissions per minute', () => {
    expect(PLAN_LIMITS.pro.submissionsPerMinute).toBe(60)
  })

  it('enterprise plan has 300 submissions per minute', () => {
    expect(PLAN_LIMITS.enterprise.submissionsPerMinute).toBe(300)
  })
})

describe('createPollRateLimiter', () => {
  it('returns a middleware function', () => {
    const limiter = createPollRateLimiter({ connection })
    expect(typeof limiter).toBe('function')
  })

  it('allows requests within 300/min limit', async () => {
    const app = makeAuthApp('free', createPollRateLimiter({ connection }))
    const res = await app.request('/test')
    expect(res.status).toBe(200)
  })

  it('includes draft-7 rate limit headers', async () => {
    const app = makeAuthApp('free', createPollRateLimiter({ connection }))
    const res = await app.request('/test')
    expect(res.headers.get('ratelimit')).not.toBeNull()
    expect(res.headers.get('ratelimit-policy')).not.toBeNull()
  })

  it('enforces 300 requests per minute limit in policy header', async () => {
    const app = makeAuthApp('free', createPollRateLimiter({ connection }))
    const res = await app.request('/test')
    expect(res.headers.get('ratelimit-policy')).toContain('300')
  })
})
