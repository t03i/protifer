import { Counter, Registry } from 'prom-client'
import { describe, expect, it, vi } from 'vitest'

import { createPrometheusFlagHook, createSentryFlagHook } from './hooks.ts'

function buildContext(flagKey: string, plan: string | undefined) {
  return {
    flagKey,
    flagValueType: 'boolean' as const,
    defaultValue: false,
    context: plan ? { plan } : {},
    clientMetadata: {},
    providerMetadata: { name: 'test' },
    logger: console,
    hookData: { set: () => undefined, get: () => undefined } as never,
  }
}

describe('createPrometheusFlagHook', () => {
  it('increments with flag, outcome=default, plan label', () => {
    const registry = new Registry()
    const counter = new Counter({
      name: 'feature_flag_evaluations_total',
      help: 'test counter',
      labelNames: ['flag', 'outcome', 'plan'] as const,
      registers: [registry],
    })
    const hook = createPrometheusFlagHook(counter)
    void hook.after?.(buildContext('shedding.enabled', 'pro'), {
      value: true,
      reason: 'DEFAULT',
      flagKey: 'shedding.enabled',
      flagMetadata: {},
    })
    const series = registry.getSingleMetric('feature_flag_evaluations_total')
    const sample = (
      series as unknown as {
        hashMap: Record<
          string,
          {
            labels: { flag: string; outcome: string; plan: string }
            value: number
          }
        >
      }
    ).hashMap
    const entry = Object.values(sample)[0]
    expect(entry?.labels).toEqual({
      flag: 'shedding.enabled',
      outcome: 'default',
      plan: 'pro',
    })
    expect(entry?.value).toBe(1)
  })

  it('records outcome=default when reason is DISABLED (productionSafe suppression is not an error)', () => {
    const registry = new Registry()
    const counter = new Counter({
      name: 'feature_flag_evaluations_total',
      help: 'test counter',
      labelNames: ['flag', 'outcome', 'plan'] as const,
      registers: [registry],
    })
    const hook = createPrometheusFlagHook(counter)
    void hook.after?.(buildContext('auth.dev_override', 'pro'), {
      value: false,
      reason: 'DISABLED',
      flagKey: 'auth.dev_override',
      flagMetadata: {},
    })
    const series = registry.getSingleMetric('feature_flag_evaluations_total')
    const sample = (
      series as unknown as {
        hashMap: Record<string, { labels: { outcome: string } }>
      }
    ).hashMap
    expect(Object.values(sample)[0]?.labels.outcome).toBe('default')
  })

  it('records outcome=error only when errorCode is set', () => {
    const registry = new Registry()
    const counter = new Counter({
      name: 'feature_flag_evaluations_total',
      help: 'test counter',
      labelNames: ['flag', 'outcome', 'plan'] as const,
      registers: [registry],
    })
    const hook = createPrometheusFlagHook(counter)
    void hook.after?.(buildContext('shedding.enabled', 'pro'), {
      value: false,
      reason: 'ERROR',
      errorCode: 'GENERAL',
      flagKey: 'shedding.enabled',
      flagMetadata: {},
    })
    const series = registry.getSingleMetric('feature_flag_evaluations_total')
    const sample = (
      series as unknown as {
        hashMap: Record<string, { labels: { outcome: string } }>
      }
    ).hashMap
    expect(Object.values(sample)[0]?.labels.outcome).toBe('error')
  })

  it('records outcome=override when reason is TARGETING_MATCH', () => {
    const registry = new Registry()
    const counter = new Counter({
      name: 'feature_flag_evaluations_total',
      help: 'test counter',
      labelNames: ['flag', 'outcome', 'plan'] as const,
      registers: [registry],
    })
    const hook = createPrometheusFlagHook(counter)
    void hook.after?.(buildContext('shedding.enforce', undefined), {
      value: true,
      reason: 'TARGETING_MATCH',
      flagKey: 'shedding.enforce',
      flagMetadata: {},
    })
    const series = registry.getSingleMetric('feature_flag_evaluations_total')
    const sample = (
      series as unknown as {
        hashMap: Record<string, { labels: { plan: string; outcome: string } }>
      }
    ).hashMap
    const entry = Object.values(sample)[0]
    expect(entry?.labels.outcome).toBe('override')
    expect(entry?.labels.plan).toBe('unknown')
  })
})

describe('createSentryFlagHook', () => {
  it('emits a breadcrumb on first evaluation', () => {
    const sink = vi.fn()
    const hook = createSentryFlagHook({ addBreadcrumb: sink })
    void hook.after?.(buildContext('shedding.enforce', 'free'), {
      value: false,
      reason: 'DEFAULT',
      flagKey: 'shedding.enforce',
      flagMetadata: {},
    })
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('throttles within window per (flag, plan)', () => {
    const sink = vi.fn()
    let now = 1_000
    const clock = { now: () => now }
    const hook = createSentryFlagHook({
      addBreadcrumb: sink,
      clock,
      throttleMs: 60_000,
    })
    void hook.after?.(buildContext('flag.x', 'pro'), {
      value: true,
      reason: 'DEFAULT',
      flagKey: 'flag.x',
      flagMetadata: {},
    })
    now += 30_000
    void hook.after?.(buildContext('flag.x', 'pro'), {
      value: true,
      reason: 'DEFAULT',
      flagKey: 'flag.x',
      flagMetadata: {},
    })
    expect(sink).toHaveBeenCalledTimes(1)

    now += 31_000
    void hook.after?.(buildContext('flag.x', 'pro'), {
      value: true,
      reason: 'DEFAULT',
      flagKey: 'flag.x',
      flagMetadata: {},
    })
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('different (flag, plan) pairs are independent', () => {
    const sink = vi.fn()
    const hook = createSentryFlagHook({ addBreadcrumb: sink })
    void hook.after?.(buildContext('flag.a', 'free'), {
      value: false,
      reason: 'DEFAULT',
      flagKey: 'flag.a',
      flagMetadata: {},
    })
    void hook.after?.(buildContext('flag.a', 'pro'), {
      value: false,
      reason: 'DEFAULT',
      flagKey: 'flag.a',
      flagMetadata: {},
    })
    void hook.after?.(buildContext('flag.b', 'free'), {
      value: false,
      reason: 'DEFAULT',
      flagKey: 'flag.b',
      flagMetadata: {},
    })
    expect(sink).toHaveBeenCalledTimes(3)
  })
})
