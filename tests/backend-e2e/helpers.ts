import { randomUUID } from 'node:crypto'

import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { Pool } from 'pg'

import { readSecretOptional } from '@protifer/shared'

const REDIS_TEST_HOST = 'localhost'
const REDIS_TEST_PORT = 16379
const REDIS_TEST_PASSWORD =
  readSecretOptional('REDIS_PASSWORD') ?? 'test-redispw'

const API_BASE = 'http://localhost:13001'

const POSTGRES_URL =
  process.env['E2E_DATABASE_URL'] ??
  'postgresql://protifer:protifer@localhost:15432/protifer'

const pool = new Pool({ connectionString: POSTGRES_URL })

const auth = betterAuth({
  database: pool,
  secret:
    process.env['BETTER_AUTH_SECRET'] ??
    'test-secret-at-least-sixteen-characters',
  baseURL: API_BASE,
  user: {
    additionalFields: {
      plan: { type: 'string', required: false, defaultValue: 'free' },
    },
  },
  plugins: [apiKey()],
})

export interface TestUser {
  userId: string
  email: string
  key: string
}

export async function createTestUser(
  plan: 'free' | 'pro' | 'enterprise' = 'pro',
  role: 'user' | 'admin' = 'user',
): Promise<TestUser> {
  const userId = `e2e-${randomUUID()}`
  const email = `${userId}@test.local`
  await pool.query(
    `INSERT INTO "user" (id, email, "emailVerified", name, "createdAt", "updatedAt", plan, role)
     VALUES ($1, $2, true, $3, NOW(), NOW(), $4, $5)`,
    [userId, email, userId, plan, role],
  )

  const result = await auth.api.createApiKey({
    body: { userId, name: `e2e-${plan}-${userId.slice(0, 8)}` },
  })
  if (!result?.key) {
    throw new Error(`Failed to mint test key for ${userId}`)
  }
  return { userId, email, key: result.key }
}

export async function deleteTestUser(userId: string): Promise<void> {
  await pool.query('DELETE FROM "apikey" WHERE "referenceId" = $1', [userId])
  await pool.query('DELETE FROM "user" WHERE id = $1', [userId])
}

export async function apiRequest(
  method: string,
  path: string,
  opts?: {
    body?: unknown
    headers?: Record<string, string>
    bearer?: string
  },
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (opts?.bearer) {
    headers['Authorization'] = `Bearer ${opts.bearer}`
  }

  Object.assign(headers, opts?.headers)

  return fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

export async function cleanQueues(): Promise<void> {
  const redis = new IORedis({
    host: REDIS_TEST_HOST,
    port: REDIS_TEST_PORT,
    password: REDIS_TEST_PASSWORD,
    maxRetriesPerRequest: null,
  })

  const embedding = new Queue('embedding', { connection: redis })
  const prediction = new Queue('prediction', { connection: redis })

  await embedding.obliterate({ force: true })
  await prediction.obliterate({ force: true })

  await embedding.close()
  await prediction.close()
  redis.disconnect()
}

export async function pollUntilComplete(
  statusUrl: string,
  bearer: string,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const res = await apiRequest('GET', statusUrl, { bearer })
    const body = (await res.json()) as {
      status: string
      error?: string
    }

    if (body.status === 'complete') {
      return body as Record<string, unknown>
    }
    if (body.status === 'failed') {
      throw new Error(`Job failed: ${body.error ?? 'unknown error'}`)
    }

    await new Promise((r) => setTimeout(r, 1000))
  }

  throw new Error(`Poll timeout after ${timeoutMs}ms`)
}

export async function shutdownE2EHelpers(): Promise<void> {
  await pool.end()
}

const SHEDDING_PENDING_KEY = 'shedding:pending_residues'
const SHEDDING_THROUGHPUT_KEY = 'shedding:throughput_ewma'
const SHEDDING_LAST_COMPLETION_KEY = 'shedding:last_completion_ms'

function redisClient(): IORedis {
  return new IORedis({
    host: REDIS_TEST_HOST,
    port: REDIS_TEST_PORT,
    password: REDIS_TEST_PASSWORD,
    maxRetriesPerRequest: null,
  })
}

export async function resetSheddingState(): Promise<void> {
  const redis = redisClient()
  try {
    await redis.del(
      SHEDDING_PENDING_KEY,
      SHEDDING_THROUGHPUT_KEY,
      SHEDDING_LAST_COMPLETION_KEY,
    )
  } finally {
    redis.disconnect()
  }
}

export interface SheddingRedisSnapshot {
  pendingResidues: number
  residuesPerSecondEwma: number | null
  lastCompletionTimestampMs: number | null
}

export async function readSheddingRedis(): Promise<SheddingRedisSnapshot> {
  const redis = redisClient()
  try {
    const [pendingRaw, ewmaRaw, tsRaw] = await Promise.all([
      redis.get(SHEDDING_PENDING_KEY),
      redis.hget(SHEDDING_THROUGHPUT_KEY, 'value'),
      redis.get(SHEDDING_LAST_COMPLETION_KEY),
    ])
    return {
      pendingResidues: pendingRaw === null ? 0 : Number(pendingRaw),
      residuesPerSecondEwma: ewmaRaw === null ? null : Number(ewmaRaw),
      lastCompletionTimestampMs: tsRaw === null ? null : Number(tsRaw),
    }
  } finally {
    redis.disconnect()
  }
}

export async function seedSheddingState(values: {
  pendingResidues?: number
  residuesPerSecondEwma?: number
  lastCompletionTimestampMs?: number
}): Promise<void> {
  const redis = redisClient()
  try {
    if (values.pendingResidues !== undefined) {
      await redis.set(SHEDDING_PENDING_KEY, String(values.pendingResidues))
    }
    if (values.residuesPerSecondEwma !== undefined) {
      await redis.hset(
        SHEDDING_THROUGHPUT_KEY,
        'value',
        String(values.residuesPerSecondEwma),
      )
    }
    if (values.lastCompletionTimestampMs !== undefined) {
      await redis.set(
        SHEDDING_LAST_COMPLETION_KEY,
        String(values.lastCompletionTimestampMs),
      )
    }
  } finally {
    redis.disconnect()
  }
}

export async function waitFor<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const intervalMs = opts.intervalMs ?? 250
  const start = Date.now()
  let last: T = await probe()
  while (Date.now() - start < timeoutMs) {
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, intervalMs))
    last = await probe()
  }
  if (predicate(last)) return last
  throw new Error(
    `waitFor timed out after ${String(timeoutMs)}ms; last=${JSON.stringify(last)}`,
  )
}
