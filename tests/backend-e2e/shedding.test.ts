import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import {
  apiRequest,
  cleanQueues,
  createTestUser,
  deleteTestUser,
  pollUntilComplete,
  readSheddingRedis,
  resetSheddingState,
  seedSheddingState,
  shutdownE2EHelpers,
  waitFor,
  type TestUser,
} from './helpers'

interface AdminStateResponse {
  pendingResidues: number
  residuesPerSecondEwma: number
  estimatedWaitSeconds: number
  lastCompletionTimestamp: string | null
  nowTimestamp: string
  mode: 'shadow' | 'enforce'
  enabled: boolean
  slo: { free: number; pro: number; enterprise: number }
  priority: { free: number; pro: number; enterprise: number }
}

describe('Request shedding E2E', () => {
  let admin: TestUser
  let pro: TestUser

  beforeAll(async () => {
    admin = await createTestUser('enterprise', 'admin')
    pro = await createTestUser('pro', 'user')
  })

  afterAll(async () => {
    await deleteTestUser(admin.userId)
    await deleteTestUser(pro.userId)
    await shutdownE2EHelpers()
  })

  beforeEach(async () => {
    await cleanQueues()
    await resetSheddingState()
  })

  describe('admin state endpoint', () => {
    it('returns 200 with expected shape for admin role', async () => {
      const res = await apiRequest('GET', '/admin/shedding/state', {
        bearer: admin.key,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as AdminStateResponse
      expect(body).toMatchObject({
        pendingResidues: 0,
        enabled: true,
      })
      expect(body.mode === 'shadow' || body.mode === 'enforce').toBe(true)
      expect(body.slo).toEqual(
        expect.objectContaining({
          free: expect.any(Number),
          pro: expect.any(Number),
          enterprise: expect.any(Number),
        }),
      )
      expect(body.priority).toEqual(
        expect.objectContaining({
          free: expect.any(Number),
          pro: expect.any(Number),
          enterprise: expect.any(Number),
        }),
      )
      expect(body.residuesPerSecondEwma).toBeGreaterThan(0)
      expect(body.nowTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('returns 403 for authenticated non-admin user', async () => {
      const res = await apiRequest('GET', '/admin/shedding/state', {
        bearer: pro.key,
      })
      expect(res.status).toBe(403)
    })

    it('returns 401 for unauthenticated request', async () => {
      const res = await apiRequest('GET', '/admin/shedding/state')
      expect(res.status).toBe(401)
    })

    it('reflects seeded pendingResidues and EWMA', async () => {
      await seedSheddingState({
        pendingResidues: 4321,
        residuesPerSecondEwma: 1500,
        lastCompletionTimestampMs: Date.now() - 5_000,
      })

      const res = await apiRequest('GET', '/admin/shedding/state', {
        bearer: admin.key,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as AdminStateResponse
      expect(body.pendingResidues).toBe(4321)
      expect(body.residuesPerSecondEwma).toBeCloseTo(1500, 0)
      expect(body.estimatedWaitSeconds).toBeCloseTo(4321 / 1500, 2)
      expect(body.lastCompletionTimestamp).not.toBeNull()
    })
  })

  describe('pending-residues accounting', () => {
    it('increments pendingResidues on submit and decrements after completion', async () => {
      const sequence =
        'MKTVRQERLKSIVRILERSKEPVSGAQLAEELSVSRQVIVQDIAYLRSLGYNIVATPR'
      const residues = sequence.length

      const submit = await apiRequest('POST', '/v1/predictions', {
        body: { sequence },
        bearer: pro.key,
      })
      expect(submit.status).toBe(202)
      const { statusUrl } = (await submit.json()) as { statusUrl: string }

      const afterSubmit = await waitFor(
        readSheddingRedis,
        (s) => s.pendingResidues >= residues,
        { timeoutMs: 5_000 },
      )
      expect(afterSubmit.pendingResidues).toBe(residues)

      await pollUntilComplete(statusUrl, pro.key)

      const afterComplete = await waitFor(
        readSheddingRedis,
        (s) => s.pendingResidues <= 0,
        { timeoutMs: 30_000 },
      )
      expect(afterComplete.pendingResidues).toBeLessThanOrEqual(0)
      expect(afterComplete.lastCompletionTimestampMs).not.toBeNull()
      expect(afterComplete.residuesPerSecondEwma ?? 0).toBeGreaterThan(0)
    })

    it('does not double-count pendingResidues on cache-hit resubmit', async () => {
      const sequence = 'ACDEFGHIKLMNPQRSTVWYACDEFGHIKLMNPQRSTVWY'
      const residues = sequence.length

      const first = await apiRequest('POST', '/v1/predictions', {
        body: { sequence },
        bearer: pro.key,
      })
      expect(first.status).toBe(202)
      const { jobId: firstId, statusUrl } = (await first.json()) as {
        jobId: string
        statusUrl: string
      }

      await waitFor(readSheddingRedis, (s) => s.pendingResidues >= residues, {
        timeoutMs: 5_000,
      })

      const beforeSecond = await readSheddingRedis()

      const second = await apiRequest('POST', '/v1/predictions', {
        body: { sequence },
        bearer: pro.key,
      })
      expect(second.status).toBe(202)
      const { jobId: secondId } = (await second.json()) as { jobId: string }
      expect(secondId).toBe(firstId)

      const afterSecond = await readSheddingRedis()
      expect(afterSecond.pendingResidues).toBeLessThanOrEqual(
        beforeSecond.pendingResidues,
      )
      expect(afterSecond.pendingResidues).toBeLessThanOrEqual(residues)

      await pollUntilComplete(statusUrl, pro.key)
      await waitFor(readSheddingRedis, (s) => s.pendingResidues <= 0, {
        timeoutMs: 30_000,
      })
    })
  })

  describe('shadow mode (default)', () => {
    it('admits submissions even when seeded state would exceed SLO', async () => {
      const adminStateBefore = await apiRequest(
        'GET',
        '/admin/shedding/state',
        { bearer: admin.key },
      )
      const cfg = (await adminStateBefore.json()) as AdminStateResponse
      if (cfg.mode !== 'shadow') {
        return
      }

      await seedSheddingState({
        pendingResidues: 10_000_000,
        residuesPerSecondEwma: 1,
        lastCompletionTimestampMs: Date.now(),
      })

      const sequence = 'MKTVRQERLKSIVRILERSKEPVSGAQLXX'
      const submit = await apiRequest('POST', '/v1/predictions', {
        body: { sequence },
        bearer: pro.key,
      })
      expect(submit.status).toBe(202)
      expect(submit.headers.get('retry-after')).toBeNull()

      const { statusUrl } = (await submit.json()) as { statusUrl: string }
      await pollUntilComplete(statusUrl, pro.key)
    })
  })
})
