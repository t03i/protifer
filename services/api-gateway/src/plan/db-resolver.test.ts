import { describe, it, expect, vi } from 'vitest'

import { DbPlanResolver } from './db-resolver.ts'

describe('DbPlanResolver', () => {
  it('returns the user.plan field verbatim when recognised', async () => {
    const getUser = vi
      .fn()
      .mockResolvedValue({ id: 'u1', plan: 'pro' as const })
    const r = new DbPlanResolver({ getUser })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toBe('pro')
    expect(getUser).toHaveBeenCalledWith('u1')
  })

  it('defaults to free when the plan field is missing', async () => {
    const getUser = vi.fn().mockResolvedValue({ id: 'u1' })
    const r = new DbPlanResolver({ getUser })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toBe('free')
  })

  it('defaults to free when the user row is missing entirely', async () => {
    const getUser = vi.fn().mockResolvedValue(null)
    const r = new DbPlanResolver({ getUser })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toBe('free')
  })

  it('defaults to free when the stored value is unrecognised', async () => {
    const getUser = vi.fn().mockResolvedValue({ id: 'u1', plan: 'gold' })
    const r = new DbPlanResolver({ getUser })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toBe('free')
  })

  it('defaults to free when getUser throws', async () => {
    const getUser = vi.fn().mockRejectedValue(new Error('db down'))
    const r = new DbPlanResolver({ getUser })
    await expect(r.resolve('u1', 'a@b.c')).resolves.toBe('free')
  })
})
