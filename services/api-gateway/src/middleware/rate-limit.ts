import type { Redis } from '@protifer/shared'
import { PLAN_LIMITS } from '@protifer/shared'
import type { Store } from 'hono-rate-limiter'
import { rateLimiter } from 'hono-rate-limiter'
import { RedisStore } from 'rate-limit-redis'

import type { Variables } from '../types/hono.ts'

function makeRedisStore(
  connection: Redis,
  prefix: string,
): Store<{ Variables: Variables }> {
  type DynamicClient = Record<string, (...args: unknown[]) => Promise<unknown>>
  const client = connection as unknown as DynamicClient
  const store = new RedisStore({
    prefix,
    // Invoke the command as a method directly on `client` so ioredis keeps its
    // `this` binding — `const fn = client[cmd]; fn(...rest)` loses it and
    // crashes inside the ioredis Commander (#42 production regression).
    sendCommand: (...args: string[]) => {
      const cmd = args[0]
      if (!cmd) throw new Error('sendCommand requires a command')
      const method = cmd.toLowerCase()
      if (typeof client[method] !== 'function') {
        throw new Error(`unsupported redis command: ${cmd}`)
      }
      return client[method](...args.slice(1)) as Promise<
        string | number | boolean | Array<string | number | boolean>
      >
    },
  } as ConstructorParameters<typeof RedisStore>[0])
  return store as unknown as Store<{ Variables: Variables }>
}

export interface RateLimitDeps {
  connection: Redis
}

export function createSubmissionRateLimiter({ connection }: RateLimitDeps) {
  return rateLimiter<{ Variables: Variables }>({
    windowMs: 60 * 1000,
    limit: (c) => {
      const plan = c.get('auth').plan
      return PLAN_LIMITS[plan].submissionsPerMinute
    },
    keyGenerator: (c) => c.get('auth').sub,
    store: makeRedisStore(connection, 'rl:submit:'),
    standardHeaders: 'draft-7',
    message: { error: 'Submission rate limit exceeded' },
    skip: (c) => !c.get('auth'),
  })
}

export function createPollRateLimiter({ connection }: RateLimitDeps) {
  return rateLimiter<{ Variables: Variables }>({
    windowMs: 60 * 1000,
    limit: 300,
    keyGenerator: (c) => c.get('auth').sub,
    store: makeRedisStore(connection, 'rl:poll:'),
    standardHeaders: 'draft-7',
    message: {
      error: 'Poll rate limit exceeded — back off your polling interval',
    },
  })
}
