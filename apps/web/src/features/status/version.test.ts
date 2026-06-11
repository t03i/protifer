import { describe, expect, it } from 'vitest'

import { compareSha, shortSha } from './version'

describe('compareSha', () => {
  it('matches identical real SHAs', () => {
    expect(compareSha('abc1234', 'abc1234')).toBe('match')
  })

  it('flags differing real SHAs as mismatch', () => {
    expect(compareSha('abc1234', 'def5678')).toBe('mismatch')
  })

  it('is unknown when the backend SHA is missing', () => {
    expect(compareSha('abc1234', undefined)).toBe('unknown')
  })

  it('is unknown when either side is a dev build', () => {
    expect(compareSha('dev', 'abc1234')).toBe('unknown')
    expect(compareSha('abc1234', 'dev')).toBe('unknown')
  })
})

describe('shortSha', () => {
  it('truncates a real SHA to 7 chars', () => {
    expect(shortSha('0123456789abcdef')).toBe('0123456')
  })

  it('passes the dev sentinel through unchanged', () => {
    expect(shortSha('dev')).toBe('dev')
  })
})
