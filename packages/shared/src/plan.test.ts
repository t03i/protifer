import { describe, it, expect } from 'vitest'

import {
  DEFAULT_PLAN_PRIORITY,
  PLAN_LIMITS,
  SHEDDING_DEFAULTS,
  loadSheddingConfig,
  parseBoolean,
} from './plan.ts'

describe('parseBoolean', () => {
  it('returns the fallback when the value is undefined', () => {
    expect(parseBoolean(undefined, true)).toBe(true)
    expect(parseBoolean(undefined, false)).toBe(false)
  })

  it('parses truthy/falsey tokens (delegating to zBooleanString)', () => {
    for (const v of ['true', '1', 'yes', 'TRUE', ' Yes ']) {
      expect(parseBoolean(v, false)).toBe(true)
    }
    for (const v of ['false', '0', 'no', 'FALSE', ' No ']) {
      expect(parseBoolean(v, true)).toBe(false)
    }
  })

  it('throws on an unparseable value', () => {
    expect(() => parseBoolean('maybe', false)).toThrow('invalid boolean')
  })
})

describe('PLAN_LIMITS', () => {
  it('free/pro/enterprise all have per-plan limits', () => {
    expect(PLAN_LIMITS.free.submissionsPerMinute).toBe(10)
    expect(PLAN_LIMITS.pro.submissionsPerMinute).toBe(60)
    expect(PLAN_LIMITS.enterprise.submissionsPerMinute).toBe(300)
  })
})

describe('DEFAULT_PLAN_PRIORITY', () => {
  it('enterprise drains before pro before free (lower = higher)', () => {
    expect(DEFAULT_PLAN_PRIORITY.enterprise).toBeLessThan(
      DEFAULT_PLAN_PRIORITY.pro,
    )
    expect(DEFAULT_PLAN_PRIORITY.pro).toBeLessThan(DEFAULT_PLAN_PRIORITY.free)
  })
})

describe('loadSheddingConfig', () => {
  it('uses documented defaults when env is empty', () => {
    const cfg = loadSheddingConfig({})
    expect(cfg.enabled).toBe(SHEDDING_DEFAULTS.SHED_ENABLED)
    expect(cfg.mode).toBe(SHEDDING_DEFAULTS.SHED_MODE)
    expect(cfg.alpha).toBe(SHEDDING_DEFAULTS.SHED_ALPHA)
    expect(cfg.stalenessSeconds).toBe(SHEDDING_DEFAULTS.SHED_STALENESS_SECONDS)
    expect(cfg.sloSeconds.free).toBe(SHEDDING_DEFAULTS.SHED_SLO_FREE_SECONDS)
    expect(cfg.sloSeconds.pro).toBe(SHEDDING_DEFAULTS.SHED_SLO_PRO_SECONDS)
    expect(cfg.sloSeconds.enterprise).toBe(
      SHEDDING_DEFAULTS.SHED_SLO_ENTERPRISE_SECONDS,
    )
    expect(cfg.initialResiduesPerSecond).toBe(
      SHEDDING_DEFAULTS.SHED_INITIAL_RESIDUES_PER_SECOND,
    )
    expect(cfg.retryJitterFraction).toBe(
      SHEDDING_DEFAULTS.SHED_RETRY_JITTER_FRACTION,
    )
    expect(cfg.priority).toEqual(DEFAULT_PLAN_PRIORITY)
  })

  it('overrides with env values', () => {
    const cfg = loadSheddingConfig({
      SHED_ENABLED: 'false',
      SHED_MODE: 'enforce',
      SHED_ALPHA: '0.5',
      SHED_STALENESS_SECONDS: '90',
      SHED_SLO_FREE_SECONDS: '15',
      SHED_SLO_PRO_SECONDS: '60',
      SHED_SLO_ENTERPRISE_SECONDS: '10',
      SHED_INITIAL_RESIDUES_PER_SECOND: '5000',
      SHED_RETRY_JITTER_FRACTION: '0.1',
      PLAN_PRIORITY_FREE: '9',
      PLAN_PRIORITY_PRO: '5',
      PLAN_PRIORITY_ENTERPRISE: '1',
    })
    expect(cfg).toEqual({
      enabled: false,
      mode: 'enforce',
      alpha: 0.5,
      stalenessSeconds: 90,
      sloSeconds: { free: 15, pro: 60, enterprise: 10 },
      initialResiduesPerSecond: 5000,
      retryJitterFraction: 0.1,
      priority: { free: 9, pro: 5, enterprise: 1 },
    })
  })

  it('rejects invalid SHED_MODE', () => {
    expect(() => loadSheddingConfig({ SHED_MODE: 'off' })).toThrow(/SHED_MODE/)
  })

  it('rejects non-numeric SHED_ALPHA', () => {
    expect(() => loadSheddingConfig({ SHED_ALPHA: 'abc' })).toThrow(/numeric/)
  })

  it('rejects SHED_ALPHA outside [0, 1]', () => {
    expect(() => loadSheddingConfig({ SHED_ALPHA: '1.5' })).toThrow(/maximum/)
    expect(() => loadSheddingConfig({ SHED_ALPHA: '-0.1' })).toThrow(/minimum/)
  })

  it('rejects non-integer SHED_STALENESS_SECONDS', () => {
    expect(() => loadSheddingConfig({ SHED_STALENESS_SECONDS: '1.5' })).toThrow(
      /integer/,
    )
  })

  it('rejects invalid SHED_ENABLED boolean', () => {
    expect(() => loadSheddingConfig({ SHED_ENABLED: 'maybe' })).toThrow(
      /boolean/,
    )
  })
})
