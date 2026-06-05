import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { requireEnv } from './env.ts'

describe('requireEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns the value when the variable is set', () => {
    process.env['MY_VAR'] = 'hello'
    expect(requireEnv('MY_VAR')).toBe('hello')
  })

  it('throws with the variable name when missing', () => {
    delete process.env['MY_VAR']
    expect(() => requireEnv('MY_VAR')).toThrow('MY_VAR')
  })

  it('throws when the variable is an empty string', () => {
    process.env['MY_VAR'] = ''
    expect(() => requireEnv('MY_VAR')).toThrow('MY_VAR')
  })
})
