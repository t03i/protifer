import type { EffectiveLimits, Plan } from '@protifer/shared'
import { describe, it, expect, vi } from 'vitest'

import { DbPlanResolver } from './db-resolver.ts'

const classDefaults: Record<Plan, EffectiveLimits> = {
  free: {
    submissionsPerMinute: 10,
    maxConcurrentJobs: 2,
    maxSequenceLength: 4096,
    sloSeconds: 30,
  },
  pro: {
    submissionsPerMinute: 60,
    maxConcurrentJobs: 10,
    maxSequenceLength: 4096,
    sloSeconds: 120,
  },
  enterprise: {
    submissionsPerMinute: 300,
    maxConcurrentJobs: 50,
    maxSequenceLength: 4096,
    sloSeconds: 0,
  },
}

describe('DbPlanResolver', () => {
  it('returns plan + class defaults when no override is present', async () => {
    const getUser = vi.fn().mockResolvedValue({ id: 'u1', plan: 'pro' })
    const r = new DbPlanResolver({ getUser, classDefaults })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toEqual({
      plan: 'pro',
      limits: classDefaults.pro,
    })
    expect(getUser).toHaveBeenCalledWith('u1')
  })

  it('merges a partial override over class defaults', async () => {
    const getUser = vi.fn().mockResolvedValue({
      id: 'u1',
      plan: 'enterprise',
      limits: { maxConcurrentJobs: 25, submissionsPerMinute: 1000 },
    })
    const r = new DbPlanResolver({ getUser, classDefaults })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toEqual({
      plan: 'enterprise',
      limits: {
        ...classDefaults.enterprise,
        maxConcurrentJobs: 25,
        submissionsPerMinute: 1000,
      },
    })
  })

  it('falls back to class defaults when the override is invalid', async () => {
    const getUser = vi.fn().mockResolvedValue({
      id: 'u1',
      plan: 'pro',
      limits: { maxConcurrentJobs: -5, bogus: 1 },
    })
    const r = new DbPlanResolver({ getUser, classDefaults })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toEqual({
      plan: 'pro',
      limits: classDefaults.pro,
    })
  })

  it('defaults to free + class defaults when the plan is unrecognised', async () => {
    const getUser = vi.fn().mockResolvedValue({ id: 'u1', plan: 'gold' })
    const r = new DbPlanResolver({ getUser, classDefaults })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toEqual({
      plan: 'free',
      limits: classDefaults.free,
    })
  })

  it('defaults to free + class defaults when getUser throws', async () => {
    const getUser = vi.fn().mockRejectedValue(new Error('db down'))
    const r = new DbPlanResolver({ getUser, classDefaults })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toEqual({
      plan: 'free',
      limits: classDefaults.free,
    })
  })
})
