import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { FlagsProvider } from './provider.ts'
import { defineFlags } from './registry.ts'
import { InMemoryFlagOverrideStore } from './store.ts'

const baseDef = {
  description: 'x',
  owner: 'p',
  createdAt: '2026-01-01',
  expiresAt: '2027-01-01',
} as const

const buildRegistry = () =>
  defineFlags({
    'global.bool': {
      ...baseDef,
      type: z.boolean(),
      default: false,
      targeting: 'global' as const,
    },
    'plan.bool': {
      ...baseDef,
      type: z.boolean(),
      default: false,
      targeting: 'plan' as const,
    },
    'pct.bool': {
      ...baseDef,
      type: z.boolean(),
      default: false,
      targeting: 'percentage' as const,
    },
    'auth.dev_override': {
      ...baseDef,
      type: z.boolean(),
      default: false,
      targeting: 'global' as const,
      productionSafe: true,
    },
  })

describe('FlagsProvider', () => {
  it('returns registry default with no override', async () => {
    const provider = new FlagsProvider({
      registry: buildRegistry(),
      store: new InMemoryFlagOverrideStore(),
    })
    const result = await provider.resolveBooleanEvaluation(
      'global.bool',
      true,
      {},
    )
    expect(result.value).toBe(false)
    expect(result.errorCode).toBeUndefined()
  })

  it('returns override when set', async () => {
    const store = new InMemoryFlagOverrideStore()
    await store.set('global.bool', { value: true }, 'admin')
    const provider = new FlagsProvider({ registry: buildRegistry(), store })

    const result = await provider.resolveBooleanEvaluation(
      'global.bool',
      false,
      {},
    )
    expect(result.value).toBe(true)
  })

  it('returns FLAG_NOT_FOUND for unknown flag', async () => {
    const provider = new FlagsProvider({
      registry: buildRegistry(),
      store: new InMemoryFlagOverrideStore(),
    })
    const result = await provider.resolveBooleanEvaluation('no.such', true, {})
    expect(result.value).toBe(true)
    expect(result.errorCode).toBe('FLAG_NOT_FOUND')
  })

  it('returns default when store fails', async () => {
    const failing = {
      get: () => Promise.reject(new Error('redis down')),
      set: () =>
        Promise.resolve({
          override: { value: false },
          updatedAt: '',
          updatedBy: '',
        }),
      delete: () => Promise.resolve(),
      getAll: () => Promise.resolve({}),
    }
    const provider = new FlagsProvider({
      registry: buildRegistry(),
      store: failing as never,
    })
    const result = await provider.resolveBooleanEvaluation(
      'global.bool',
      true,
      {},
    )
    expect(result.value).toBe(false)
    expect(result.errorCode).toBeDefined()
  })

  it('returns TYPE_MISMATCH when caller asks for wrong type', async () => {
    const provider = new FlagsProvider({
      registry: buildRegistry(),
      store: new InMemoryFlagOverrideStore(),
    })
    const result = await provider.resolveStringEvaluation(
      'global.bool',
      'fallback',
      {},
    )
    expect(result.value).toBe('fallback')
    expect(result.errorCode).toBe('TYPE_MISMATCH')
  })

  it('plan-targeting returns per-plan override', async () => {
    const store = new InMemoryFlagOverrideStore()
    await store.set(
      'plan.bool',
      { perPlan: { free: false, pro: true, enterprise: true } },
      'admin',
    )
    const provider = new FlagsProvider({ registry: buildRegistry(), store })
    const result = await provider.resolveBooleanEvaluation('plan.bool', false, {
      plan: 'pro',
    })
    expect(result.value).toBe(true)
  })

  it('percentage-targeting respects userId', async () => {
    const store = new InMemoryFlagOverrideStore()
    await store.set('pct.bool', { percentage: 100, value: true }, 'admin')
    const provider = new FlagsProvider({ registry: buildRegistry(), store })
    const result = await provider.resolveBooleanEvaluation('pct.bool', false, {
      userId: 'u1',
    })
    expect(result.value).toBe(true)
  })

  it('production-safe flag suppresses override in production with reason=DISABLED (not an error)', async () => {
    const store = new InMemoryFlagOverrideStore()
    await store.set('auth.dev_override', { value: true }, 'admin')
    const provider = new FlagsProvider({
      registry: buildRegistry(),
      store,
      getNodeEnv: () => 'production',
    })
    const result = await provider.resolveBooleanEvaluation(
      'auth.dev_override',
      false,
      {},
    )
    expect(result.value).toBe(false)
    expect(result.reason).toBe('DISABLED')
    expect(result.errorCode).toBeUndefined()
  })

  it('production-safe flag honors override in development', async () => {
    const store = new InMemoryFlagOverrideStore()
    await store.set('auth.dev_override', { value: true }, 'admin')
    const provider = new FlagsProvider({
      registry: buildRegistry(),
      store,
      getNodeEnv: () => 'development',
    })
    const result = await provider.resolveBooleanEvaluation(
      'auth.dev_override',
      false,
      {},
    )
    expect(result.value).toBe(true)
  })
})
