import { describe, it, expect, beforeEach } from 'vitest'

import { apiRequest, cleanQueues } from './helpers'

describe('Auth rejection E2E', () => {
  beforeEach(async () => {
    await cleanQueues()
  })

  it('returns 401 for POST with no Bearer token and no session', async () => {
    const res = await apiRequest('POST', '/v1/predictions', {
      body: { sequence: 'MKTVRQERLKSIVRILERSKEPVSGAQL' },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 401 for POST with an invalid Bearer token', async () => {
    const res = await apiRequest('POST', '/v1/predictions', {
      body: { sequence: 'MKTVRQERLKSIVRILERSKEPVSGAQL' },
      bearer: 'invalid-key-not-in-db',
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 401 on GET for a non-existent jobId with invalid Bearer', async () => {
    const res = await apiRequest('GET', '/v1/predictions/nonexistent-job-id', {
      bearer: 'invalid-key-not-in-db',
    })

    expect(res.status).toBe(401)
  })
})
