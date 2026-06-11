import { describe, expect, it } from 'vitest'

import { createHealthRouter } from './health.ts'

describe('GET /health', () => {
  it('returns ok with timestamp and build sha', async () => {
    const app = createHealthRouter({ sha: 'abc1234' })
    const res = await app.request('/')

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      timestamp: string
      sha: string
    }
    expect(body.status).toBe('ok')
    expect(body.sha).toBe('abc1234')
    expect(typeof body.timestamp).toBe('string')
  })

  it('reports the dev sentinel when no build sha was injected', async () => {
    const app = createHealthRouter({ sha: 'dev' })
    const res = await app.request('/')
    const body = (await res.json()) as { sha: string }
    expect(body.sha).toBe('dev')
  })
})
