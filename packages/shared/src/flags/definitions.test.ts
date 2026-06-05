import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildAppFlagRegistry } from './definitions.ts'

describe('buildAppFlagRegistry', () => {
  const original = {
    SHED_ENABLED: process.env['SHED_ENABLED'],
    SHED_MODE: process.env['SHED_MODE'],
  }
  beforeEach(() => {
    delete process.env['SHED_ENABLED']
    delete process.env['SHED_MODE']
  })
  afterEach(() => {
    if (original.SHED_ENABLED === undefined) delete process.env['SHED_ENABLED']
    else process.env['SHED_ENABLED'] = original.SHED_ENABLED
    if (original.SHED_MODE === undefined) delete process.env['SHED_MODE']
    else process.env['SHED_MODE'] = original.SHED_MODE
  })

  it('uses explicit defaults arg over env', () => {
    process.env['SHED_ENABLED'] = 'false'
    process.env['SHED_MODE'] = 'enforce'
    const r = buildAppFlagRegistry({
      sheddingEnabled: true,
      sheddingEnforce: false,
    })
    expect(r['shedding.enabled'].default).toBe(true)
    expect(r['shedding.enforce'].default).toBe(false)
  })

  it('falls back to env when defaults arg is omitted', () => {
    process.env['SHED_ENABLED'] = 'false'
    process.env['SHED_MODE'] = 'enforce'
    const r = buildAppFlagRegistry()
    expect(r['shedding.enabled'].default).toBe(false)
    expect(r['shedding.enforce'].default).toBe(true)
  })

  it('shedding.enabled defaults to true when neither defaults nor env are set', () => {
    const r = buildAppFlagRegistry()
    expect(r['shedding.enabled'].default).toBe(true)
    expect(r['shedding.enforce'].default).toBe(false)
  })
})
