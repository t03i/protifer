import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  evaluate,
  evaluateGlobal,
  evaluatePercentage,
  evaluatePlan,
  stableBucket,
} from './targeting.ts'
import type { FlagDefinition } from './types.ts'

const def = (
  targeting: 'global' | 'plan' | 'percentage',
  defaultValue = false,
): FlagDefinition<boolean> => ({
  description: 'x',
  type: z.boolean(),
  default: defaultValue,
  targeting,
  owner: 'p',
  createdAt: '2026-01-01',
  expiresAt: '2027-01-01',
})

describe('evaluateGlobal', () => {
  it('returns the override value when present', () => {
    expect(evaluateGlobal(def('global', false), { value: true })).toBe(true)
  })
  it('returns the default when no override', () => {
    expect(evaluateGlobal(def('global', false), null)).toBe(false)
  })
})

describe('evaluatePlan', () => {
  it('returns per-plan value', () => {
    expect(
      evaluatePlan(
        def('plan', false),
        { perPlan: { free: false, pro: true, enterprise: true } },
        { plan: 'pro' },
      ),
    ).toBe(true)
  })
  it('falls back to default when plan not in map', () => {
    expect(
      evaluatePlan(
        def('plan', false),
        { perPlan: { free: false, pro: true } },
        { plan: 'enterprise' },
      ),
    ).toBe(false)
  })
  it('falls back to default when ctx.plan missing', () => {
    expect(
      evaluatePlan(def('plan', false), { perPlan: { free: true } }, {}),
    ).toBe(false)
  })
})

describe('evaluatePercentage', () => {
  it('returns default when percentage is 0', () => {
    expect(
      evaluatePercentage(
        'flag',
        def('percentage', false),
        {
          percentage: 0,
          value: true,
        },
        { userId: 'u1' },
      ),
    ).toBe(false)
  })
  it('returns override when percentage is 100', () => {
    expect(
      evaluatePercentage(
        'flag',
        def('percentage', false),
        {
          percentage: 100,
          value: true,
        },
        { userId: 'u1' },
      ),
    ).toBe(true)
  })
  it('falls back to default when userId missing', () => {
    expect(
      evaluatePercentage(
        'flag',
        def('percentage', false),
        {
          percentage: 50,
          value: true,
        },
        {},
      ),
    ).toBe(false)
  })
  it('is stable across calls', () => {
    const ctx = { userId: 'u1' }
    const a = evaluatePercentage(
      'flag',
      def('percentage', false),
      { percentage: 50, value: true },
      ctx,
    )
    const b = evaluatePercentage(
      'flag',
      def('percentage', false),
      { percentage: 50, value: true },
      ctx,
    )
    expect(a).toBe(b)
  })
  it('different users land in different buckets', () => {
    const buckets = new Set<number>()
    for (const id of ['u1', 'u2', 'u3', 'u4', 'u5']) {
      buckets.add(stableBucket('flag', id))
    }
    expect(buckets.size).toBeGreaterThan(1)
  })

  it('roughly honors the percentage across many users', () => {
    const N = 2000
    let on = 0
    for (let i = 0; i < N; i++) {
      const v = evaluatePercentage(
        'flag',
        def('percentage', false),
        { percentage: 50, value: true },
        { userId: `user-${String(i)}` },
      )
      if (v) on++
    }
    // 50% target ± 5% tolerance over 2000 users.
    const ratio = on / N
    expect(ratio).toBeGreaterThan(0.45)
    expect(ratio).toBeLessThan(0.55)
  })
})

describe('evaluate (dispatcher)', () => {
  it('selects based on targeting', () => {
    expect(evaluate('f', def('global', false), { value: true }, {})).toBe(true)
    expect(
      evaluate(
        'f',
        def('plan', false),
        { perPlan: { pro: true } },
        { plan: 'pro' },
      ),
    ).toBe(true)
  })
})
