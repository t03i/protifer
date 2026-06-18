import IORedis from 'ioredis'
import { describe, it, expect } from 'vitest'

import { readSecretOptional } from '@protifer/shared'

describe('Service health verification', () => {
  it('API gateway is healthy', async () => {
    const res = await fetch('http://localhost:13001/health')
    expect(res.status).toBe(200)
  })

  it('Triton probe route reports ready against the Triton stub', async () => {
    const res = await fetch('http://localhost:13001/health/triton')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body).toEqual({ status: 'ok' })
  })

  it('Redis is reachable', async () => {
    const redis = new IORedis({
      host: 'localhost',
      port: 16379,
      password: readSecretOptional('REDIS_PASSWORD') ?? 'test-redispw',
      maxRetriesPerRequest: null,
    })
    const pong = await redis.ping()
    expect(pong).toBe('PONG')
    redis.disconnect()
  })

  it('Triton stub HTTP health is reachable', async () => {
    // Real tritonserver exposes /v2/health/ready (KServe), not the old
    // mock-triton's /health; the test stack maps HTTP to host :18000.
    const res = await fetch('http://localhost:18000/v2/health/ready')
    expect(res.status).toBe(200)
  })

  it('Garage S3 is reachable', async () => {
    const res = await fetch('http://localhost:13903/health')
    expect(res.status).toBe(200)
  })
})
