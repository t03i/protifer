import { describe, expect, it, vi } from 'vitest'

import { createHealthTritonRouter } from './health-triton.ts'

describe('GET /health/triton', () => {
  it('returns 200 with {status:"ok"} when Triton is ready', async () => {
    const app = createHealthTritonRouter({
      triton: vi.fn().mockResolvedValue(true),
    })
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('returns 503 with {status:"down"} when Triton reports not ready', async () => {
    const app = createHealthTritonRouter({
      triton: vi.fn().mockResolvedValue(false),
    })
    const res = await app.request('/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('down')
    expect(JSON.stringify(body)).not.toMatch(/grpc|triton|error/i)
  })

  it('returns 503 when Triton throws an exception', async () => {
    const app = createHealthTritonRouter({
      triton: vi.fn().mockRejectedValue(new Error('gRPC UNAVAILABLE')),
    })
    const res = await app.request('/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('down')
    expect(JSON.stringify(body)).not.toContain('gRPC UNAVAILABLE')
  })

  it('returns 503 when Triton hangs past the timeout', async () => {
    const app = createHealthTritonRouter({
      triton: () => new Promise<boolean>(() => {}),
      timeoutMs: 100,
    })
    const res = await app.request('/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('down')
  }, 5_000)
})
