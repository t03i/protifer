import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { buildOriginMatcher } from './app.ts'

describe('CORS origin matcher (Phase 22 D-09)', () => {
  let savedCorsOrigins: string | undefined

  beforeEach(() => {
    savedCorsOrigins = process.env['CORS_ORIGINS']
  })

  afterEach(() => {
    if (savedCorsOrigins === undefined) {
      delete process.env['CORS_ORIGINS']
    } else {
      process.env['CORS_ORIGINS'] = savedCorsOrigins
    }
  })

  it('accepts exact-match origin', () => {
    const match = buildOriginMatcher(
      'https://protifer.example.com,https://admin.example.com',
    )
    expect(match('https://protifer.example.com')).toBe(
      'https://protifer.example.com',
    )
    expect(match('https://admin.example.com')).toBe('https://admin.example.com')
  })

  it('rejects unknown origin', () => {
    const match = buildOriginMatcher('https://protifer.example.com')
    expect(match('https://evil.com')).toBeNull()
  })

  it('rejects undefined / missing Origin header', () => {
    const match = buildOriginMatcher('https://protifer.example.com')
    expect(match(undefined)).toBeNull()
  })

  it('accepts single-segment wildcard (*.vercel.app → preview URLs)', () => {
    const match = buildOriginMatcher('https://*.vercel.app')
    expect(match('https://protifer-abc123.vercel.app')).toBe(
      'https://protifer-abc123.vercel.app',
    )
    expect(match('https://pr-42-protifer.vercel.app')).toBe(
      'https://pr-42-protifer.vercel.app',
    )
  })

  it('REJECTS overmatch attempt (evil.com.vercel.app should NOT match *.vercel.app with multi-segment wildcard)', () => {
    // Security-critical: CORS wildcard overmatch. Regex must use [^.]+
    // (single-segment), not .*
    const match = buildOriginMatcher('https://*.vercel.app')
    expect(match('https://evil.com.vercel.app')).toBeNull()
  })

  it('combines exact + wildcard entries from comma-separated env', () => {
    const match = buildOriginMatcher(
      'https://protifer.example.com,https://*.vercel.app,https://staging.example.com',
    )
    expect(match('https://protifer.example.com')).toBe(
      'https://protifer.example.com',
    )
    expect(match('https://preview-7.vercel.app')).toBe(
      'https://preview-7.vercel.app',
    )
    expect(match('https://staging.example.com')).toBe(
      'https://staging.example.com',
    )
    expect(match('https://other.com')).toBeNull()
  })

  it('handles whitespace in comma-separated entries', () => {
    const match = buildOriginMatcher('  https://a.com  ,  https://b.com  ')
    expect(match('https://a.com')).toBe('https://a.com')
    expect(match('https://b.com')).toBe('https://b.com')
  })

  it('drops empty entries from trailing comma', () => {
    const match = buildOriginMatcher('https://a.com,,https://b.com,')
    expect(match('https://a.com')).toBe('https://a.com')
    expect(match('https://b.com')).toBe('https://b.com')
  })
})
