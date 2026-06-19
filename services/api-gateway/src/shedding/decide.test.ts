import { loadSheddingConfig } from '@protifer/shared'
import type { Plan } from '@protifer/shared'
import { describe, it, expect } from 'vitest'

import { decideAdmission } from './decide.ts'
import type { SheddingStateSnapshot } from './state.ts'

const baseState: SheddingStateSnapshot = {
  pendingResidues: 0,
  residuesPerSecondEwma: 1000,
  lastCompletionTimestampMs: 1_000_000,
}

const fixedJitter = () => 0.5 // centered — retry-after = baseSeconds

describe('decideAdmission', () => {
  it('admits free user below SLO', () => {
    const cfg = loadSheddingConfig({ SHED_SLO_FREE_SECONDS: '30' })
    const decision = decideAdmission({
      state: { ...baseState, pendingResidues: 1000 }, // 1s wait
      config: cfg,
      plan: 'free',
      sequenceResidues: 500, // + 500 → 1.5s
      nowMs: 1_000_000,
      jitter: fixedJitter,
    })
    expect(decision.admit).toBe(true)
    expect(decision.code).toBeUndefined()
    expect(decision.estimatedWaitSeconds).toBeCloseTo(1.5)
  })

  it('sheds free user above SLO with OVERLOADED', () => {
    const cfg = loadSheddingConfig({
      SHED_SLO_FREE_SECONDS: '30',
      SHED_RETRY_JITTER_FRACTION: '0.3',
    })
    const state: SheddingStateSnapshot = {
      pendingResidues: 60_000, // 60s wait already
      residuesPerSecondEwma: 1000,
      lastCompletionTimestampMs: 1_000_000,
    }
    const decision = decideAdmission({
      state,
      config: cfg,
      plan: 'free',
      sequenceResidues: 100,
      nowMs: 1_000_000,
      jitter: fixedJitter,
    })
    expect(decision.admit).toBe(false)
    expect(decision.code).toBe('OVERLOADED')
    expect(decision.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('admits pro user with longer SLO where free would shed', () => {
    const cfg = loadSheddingConfig({
      SHED_SLO_FREE_SECONDS: '30',
      SHED_SLO_PRO_SECONDS: '120',
    })
    const state: SheddingStateSnapshot = {
      pendingResidues: 60_000, // 60s wait
      residuesPerSecondEwma: 1000,
      lastCompletionTimestampMs: 1_000_000,
    }
    expect(
      decideAdmission({
        state,
        config: cfg,
        plan: 'free',
        sequenceResidues: 0,
        nowMs: 1_000_000,
        jitter: fixedJitter,
      }).admit,
    ).toBe(false)
    expect(
      decideAdmission({
        state,
        config: cfg,
        plan: 'pro',
        sequenceResidues: 0,
        nowMs: 1_000_000,
        jitter: fixedJitter,
      }).admit,
    ).toBe(true)
  })

  it('enterprise SLO=0 never sheds on overload', () => {
    const cfg = loadSheddingConfig({
      SHED_SLO_ENTERPRISE_SECONDS: '0',
    })
    const decision = decideAdmission({
      state: {
        pendingResidues: 10_000_000, // astronomical wait
        residuesPerSecondEwma: 1000,
        lastCompletionTimestampMs: 1_000_000,
      },
      config: cfg,
      plan: 'enterprise',
      sequenceResidues: 100,
      nowMs: 1_000_000,
      jitter: fixedJitter,
    })
    expect(decision.admit).toBe(true)
    expect(decision.code).toBeUndefined()
  })

  it('enterprise is shed on UPSTREAM_DOWN even with SLO=0', () => {
    const cfg = loadSheddingConfig({
      SHED_SLO_ENTERPRISE_SECONDS: '0',
      SHED_STALENESS_SECONDS: '60',
    })
    const decision = decideAdmission({
      state: {
        pendingResidues: 1000,
        residuesPerSecondEwma: 1000,
        lastCompletionTimestampMs: 0, // very old
      },
      config: cfg,
      plan: 'enterprise',
      sequenceResidues: 100,
      nowMs: 120_000, // > 60s stale
      jitter: fixedJitter,
    })
    expect(decision.admit).toBe(false)
    expect(decision.code).toBe('UPSTREAM_DOWN')
  })

  it('staleness with empty queue admits (idle ≠ outage)', () => {
    const cfg = loadSheddingConfig({ SHED_STALENESS_SECONDS: '60' })
    const decision = decideAdmission({
      state: {
        pendingResidues: 0,
        residuesPerSecondEwma: 1000,
        lastCompletionTimestampMs: 0,
      },
      config: cfg,
      plan: 'pro',
      sequenceResidues: 100,
      nowMs: 9_999_999,
      jitter: fixedJitter,
    })
    expect(decision.admit).toBe(true)
  })

  it('Retry-After uses staleness seconds (with jitter) on UPSTREAM_DOWN', () => {
    const cfg = loadSheddingConfig({
      SHED_STALENESS_SECONDS: '45',
      SHED_RETRY_JITTER_FRACTION: '0',
    })
    const decision = decideAdmission({
      state: {
        pendingResidues: 2000,
        residuesPerSecondEwma: 1000,
        lastCompletionTimestampMs: 0,
      },
      config: cfg,
      plan: 'free',
      sequenceResidues: 0,
      nowMs: 60_000,
      jitter: fixedJitter,
    })
    expect(decision.retryAfterSeconds).toBe(45)
  })

  it('Retry-After is a non-negative integer', () => {
    const cfg = loadSheddingConfig({
      SHED_SLO_FREE_SECONDS: '1',
      SHED_RETRY_JITTER_FRACTION: '0.5',
    })
    const decision = decideAdmission({
      state: {
        pendingResidues: 10_000,
        residuesPerSecondEwma: 1000,
        lastCompletionTimestampMs: 1_000_000,
      },
      config: cfg,
      plan: 'free',
      sequenceResidues: 0,
      nowMs: 1_000_000,
      jitter: () => 0, // minimum of the jitter range
    })
    expect(Number.isInteger(decision.retryAfterSeconds)).toBe(true)
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(0)
  })

  // Deep, sustained overload — the regime the gateway rate limiter masks from
  // load tests, so it is covered here at the pure-decision layer instead.
  describe('deep overload (calibration curve)', () => {
    const throughput = 1000 // residues/sec
    const cfg = loadSheddingConfig({
      SHED_SLO_PRO_SECONDS: '60',
      SHED_RETRY_JITTER_FRACTION: '0',
    })
    const at = (pendingResidues: number, plan: Plan, c = cfg) =>
      decideAdmission({
        state: {
          pendingResidues,
          residuesPerSecondEwma: throughput,
          lastCompletionTimestampMs: 1_000_000,
        },
        config: c,
        plan,
        sequenceResidues: 0,
        nowMs: 1_000_000,
        jitter: fixedJitter,
      })

    it('admits exactly at the SLO boundary and sheds just past it', () => {
      // wait = pending / throughput; SLO 60s → boundary at 60_000 residues
      expect(at(60_000, 'pro').admit).toBe(true) // 60s == SLO, not > SLO
      const past = at(60_001, 'pro')
      expect(past.admit).toBe(false)
      expect(past.code).toBe('OVERLOADED')
    })

    it('retry-after grows with the depth of overload', () => {
      const [shallow, mid, deep] = [120_000, 600_000, 3_000_000].map(
        (p) => at(p, 'pro').retryAfterSeconds ?? 0,
      )
      expect(shallow).toBe(120) // jitter off → ceil(estimated wait)
      expect(shallow).toBeLessThan(mid ?? 0)
      expect(mid).toBeLessThan(deep ?? 0)
    })

    it('sustained deep overload still admits enterprise (SLO=0) while shedding pro', () => {
      const c = loadSheddingConfig({
        SHED_SLO_ENTERPRISE_SECONDS: '0',
        SHED_SLO_PRO_SECONDS: '60',
      })
      expect(at(10_000_000, 'enterprise', c).admit).toBe(true)
      expect(at(10_000_000, 'pro', c).admit).toBe(false)
    })
  })

  it('estimated wait uses initial throughput when EWMA is 0', () => {
    const cfg = loadSheddingConfig({
      SHED_INITIAL_RESIDUES_PER_SECOND: '2000',
    })
    const decision = decideAdmission({
      state: {
        pendingResidues: 2000,
        residuesPerSecondEwma: 0,
        lastCompletionTimestampMs: null,
      },
      config: cfg,
      plan: 'pro',
      sequenceResidues: 0,
      nowMs: 0,
      jitter: fixedJitter,
    })
    expect(decision.estimatedWaitSeconds).toBe(1)
    expect(decision.admit).toBe(true)
  })
})
