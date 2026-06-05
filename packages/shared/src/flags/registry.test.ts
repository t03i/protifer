import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineFlags, FlagRegistryError } from './registry.ts'

const baseDef = {
  description: 'A flag',
  type: z.boolean(),
  default: false,
  targeting: 'global' as const,
  owner: 'platform',
  createdAt: '2026-04-25',
  expiresAt: '2026-10-25',
}

describe('defineFlags', () => {
  it('accepts a well-formed registry', () => {
    const r = defineFlags({ 'a.b': baseDef })
    expect(r['a.b'].default).toBe(false)
  })

  it('throws on missing description', () => {
    expect(() =>
      defineFlags({ 'a.b': { ...baseDef, description: '' } }),
    ).toThrow(FlagRegistryError)
  })

  it('throws on invalid date format', () => {
    expect(() =>
      defineFlags({ 'a.b': { ...baseDef, expiresAt: 'tomorrow' } }),
    ).toThrow(FlagRegistryError)
  })

  it('throws when expiresAt is earlier than createdAt', () => {
    expect(() =>
      defineFlags({
        'a.b': { ...baseDef, createdAt: '2026-10-01', expiresAt: '2026-04-01' },
      }),
    ).toThrow(/earlier than createdAt/)
  })

  it('throws when default value fails the Zod type', () => {
    expect(() =>
      defineFlags({
        'a.b': {
          ...baseDef,
          type: z.boolean(),
          default: 'maybe' as unknown as boolean,
        },
      }),
    ).toThrow(/fails type validation/)
  })

  it('throws on unknown targeting mode', () => {
    expect(() =>
      defineFlags({
        'a.b': {
          ...baseDef,
          targeting: 'cohort' as unknown as 'global',
        },
      }),
    ).toThrow(/targeting must be one of/)
  })

  it('throws on missing owner', () => {
    expect(() => defineFlags({ 'a.b': { ...baseDef, owner: '' } })).toThrow(
      /owner is required/,
    )
  })
})
