import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  apiRequest,
  cleanQueues,
  createTestUser,
  deleteTestUser,
  setUserLimits,
  type TestUser,
} from './helpers'

const SEQUENCE = 'MKTVRQERLKSIVRILERSKEPVSGAQL' // 28 residues

describe('Per-account limit overrides E2E', () => {
  const created: string[] = []

  beforeEach(async () => {
    await cleanQueues()
  })

  afterEach(async () => {
    for (const id of created.splice(0)) await deleteTestUser(id)
  })

  async function freeUser(): Promise<TestUser> {
    const u = await createTestUser('free')
    created.push(u.userId)
    return u
  }

  it('enforces a per-account maxSequenceLength override below the plan default', async () => {
    const u = await freeUser()
    await setUserLimits(u.userId, { maxSequenceLength: 10 })

    const res = await apiRequest('POST', '/v1/embeddings', {
      body: { sequence: SEQUENCE },
      bearer: u.key,
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('admits the same sequence for an account on the plan default', async () => {
    const u = await freeUser()

    const res = await apiRequest('POST', '/v1/embeddings', {
      body: { sequence: SEQUENCE },
      bearer: u.key,
    })

    expect(res.status).toBe(202)
  })
})
