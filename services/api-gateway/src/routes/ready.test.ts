import { describe, it, expect, vi } from 'vitest'

import { createReadyRouter } from './ready.ts'

type CheckRecord = { status: string; detail?: string }
type ReadyBody = {
  status: string
  checks: Record<string, CheckRecord>
}

function getCheck(body: ReadyBody, name: string): CheckRecord {
  const check = body.checks[name]
  if (!check) throw new Error(`expected '${name}' in ready body`)
  return check
}

describe('GET /ready', () => {
  it('returns 200 + per-dep ok when every check succeeds', async () => {
    const app = createReadyRouter({
      redis: vi.fn().mockResolvedValue(undefined),
      postgres: vi.fn().mockResolvedValue(undefined),
    })
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ReadyBody
    expect(body.status).toBe('ok')
    expect(getCheck(body, 'redis').status).toBe('ok')
    expect(getCheck(body, 'postgres').status).toBe('ok')
  })

  it('returns 503 with detail when Redis is down', async () => {
    const app = createReadyRouter({
      redis: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      postgres: vi.fn().mockResolvedValue(undefined),
    })
    const res = await app.request('/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as ReadyBody
    expect(body.status).toBe('down')
    expect(getCheck(body, 'redis').status).toBe('down')
    expect(getCheck(body, 'redis').detail).toContain('ECONNREFUSED')
    expect(getCheck(body, 'postgres').status).toBe('ok')
  })

  it('returns 503 when Postgres SELECT 1 fails', async () => {
    const app = createReadyRouter({
      redis: vi.fn().mockResolvedValue(undefined),
      postgres: vi.fn().mockRejectedValue(new Error('pg down')),
    })
    const res = await app.request('/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as ReadyBody
    expect(body.status).toBe('down')
    expect(getCheck(body, 'postgres').status).toBe('down')
    expect(getCheck(body, 'postgres').detail).toContain('pg down')
    expect(getCheck(body, 'redis').status).toBe('ok')
  })

  it('reports every failed dep, not just the first', async () => {
    const app = createReadyRouter({
      redis: vi.fn().mockRejectedValue(new Error('redis gone')),
      postgres: vi.fn().mockRejectedValue(new Error('pg gone')),
    })
    const res = await app.request('/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as ReadyBody
    expect(getCheck(body, 'redis').status).toBe('down')
    expect(getCheck(body, 'postgres').status).toBe('down')
  })

  it('includes Triton when a triton checker is supplied', async () => {
    const app = createReadyRouter({
      redis: vi.fn().mockResolvedValue(undefined),
      postgres: vi.fn().mockResolvedValue(undefined),
      triton: vi.fn().mockRejectedValue(new Error('not ready')),
    })
    const res = await app.request('/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as ReadyBody
    expect(getCheck(body, 'triton').status).toBe('down')
    expect(getCheck(body, 'triton').detail).toContain('not ready')
  })

  it('fails the check with a timeout when a dep hangs', async () => {
    const app = createReadyRouter({
      // never resolves — the timeout in ready.ts must trip it
      redis: () => new Promise<void>(() => {}),
      postgres: vi.fn().mockResolvedValue(undefined),
    })
    const res = await app.request('/')
    expect(res.status).toBe(503)
    const body = (await res.json()) as ReadyBody
    expect(getCheck(body, 'redis').status).toBe('down')
    expect(getCheck(body, 'redis').detail).toMatch(/timeout/i)
  }, 10_000)
})
