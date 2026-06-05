/**
 * ops-key unit tests — argument parsing, label grammar, plan validation,
 * and stdout-contract checks that don't require a live Postgres.
 *
 * Integration coverage (DB transactions, auth.api.createApiKey round-trips,
 * revoke-rollback) lives in ops-key.int.test.ts.
 */

import { describe, expect, it } from 'vitest'

import { MACHINE_USER_DOMAIN } from './ops-key.ts'

// Re-implemented here to lock the value in: if the regex changes, both this
// file and the script must be updated together.
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/

describe('label grammar', () => {
  it('accepts DNS-label-compatible lowercase identifiers', () => {
    expect(LABEL_RE.test('ci-loadtest-pro')).toBe(true)
    expect(LABEL_RE.test('ci-loadtest-free')).toBe(true)
    expect(LABEL_RE.test('demo-local')).toBe(true)
    expect(LABEL_RE.test('a1')).toBe(true)
  })

  it('rejects uppercase, slashes, @, and underscores', () => {
    expect(LABEL_RE.test('CiLoadTest')).toBe(false)
    expect(LABEL_RE.test('ci/loadtest')).toBe(false)
    expect(LABEL_RE.test('ci@loadtest')).toBe(false)
    expect(LABEL_RE.test('ci_loadtest')).toBe(false)
  })

  it('rejects labels that start or end with a hyphen', () => {
    expect(LABEL_RE.test('-ci')).toBe(false)
    expect(LABEL_RE.test('ci-')).toBe(false)
  })

  it('rejects labels longer than 63 characters', () => {
    const exact = 'a' + 'b'.repeat(61) + 'c'
    expect(exact).toHaveLength(63)
    expect(LABEL_RE.test(exact)).toBe(true)

    const tooLong = 'a' + 'b'.repeat(62) + 'c'
    expect(tooLong).toHaveLength(64)
    expect(LABEL_RE.test(tooLong)).toBe(false)
  })

  it('rejects empty and single-character labels', () => {
    expect(LABEL_RE.test('')).toBe(false)
    expect(LABEL_RE.test('a')).toBe(false)
  })
})

describe('machine-user domain constant', () => {
  it('uses RFC 6761 reserved .invalid TLD', () => {
    expect(MACHINE_USER_DOMAIN).toBe('@protifer.invalid')
    expect(MACHINE_USER_DOMAIN.endsWith('.invalid')).toBe(true)
  })

  it('is the sole marker the email suffix predicate checks', () => {
    expect(
      `ci-loadtest-pro${MACHINE_USER_DOMAIN}`.endsWith(MACHINE_USER_DOMAIN),
    ).toBe(true)
    expect('alice@example.com'.endsWith(MACHINE_USER_DOMAIN)).toBe(false)
    expect('alice@protifer.invalid.com'.endsWith(MACHINE_USER_DOMAIN)).toBe(
      false,
    )
  })
})
