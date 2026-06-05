import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import {
  apiRequest,
  cleanQueues,
  createTestUser,
  deleteTestUser,
  pollUntilComplete,
  shutdownE2EHelpers,
  type TestUser,
} from './helpers'

describe('Full prediction pipeline E2E', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser('pro')
  })

  afterAll(async () => {
    await deleteTestUser(user.userId)
    await shutdownE2EHelpers()
  })

  beforeEach(async () => {
    await cleanQueues()
  })

  it('submits a sequence and receives prediction result', async () => {
    const sequence = 'MKTVRQERLKSIVRILERSKEPVSGAQL'

    const submitRes = await apiRequest('POST', '/v1/predictions', {
      body: { sequence },
      bearer: user.key,
    })

    expect(submitRes.status).toBe(202)
    const { jobId, statusUrl } = (await submitRes.json()) as {
      jobId: string
      statusUrl: string
    }
    expect(jobId).toBeTruthy()

    const result = await pollUntilComplete(statusUrl, user.key)

    expect(result.status).toBe('complete')
    const stored = result['result'] as {
      outputs: { prott5_secondary_structure?: { dssp3: string } }
    }
    expect(stored.outputs).toHaveProperty('prott5_secondary_structure')
    const ss = stored.outputs.prott5_secondary_structure as { dssp3: string }
    expect(ss.dssp3).toHaveLength(sequence.length)
  })

  it('returns 202 for idempotent re-submission', async () => {
    const sequence = 'ACDEFGHIKLMNPQRSTVWY'

    const r1 = await apiRequest('POST', '/v1/predictions', {
      body: { sequence },
      bearer: user.key,
    })
    const r2 = await apiRequest('POST', '/v1/predictions', {
      body: { sequence },
      bearer: user.key,
    })

    expect(r1.status).toBe(202)
    expect(r2.status).toBe(202)

    const b1 = (await r1.json()) as { jobId: string }
    const b2 = (await r2.json()) as { jobId: string }
    expect(b1.jobId).toBe(b2.jobId)
  })
})
