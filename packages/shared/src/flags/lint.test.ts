import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { lintRegistry, hasIssues } from './lint.ts'
import { defineFlags } from './registry.ts'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'flags-lint-'))
}

const baseDef = {
  description: 'x',
  type: z.boolean(),
  default: false,
  targeting: 'global' as const,
  owner: 'p',
  createdAt: '2026-01-01',
  expiresAt: '2027-01-01',
}

describe('lintRegistry', () => {
  it('flags expired flags', () => {
    const dir = tmp()
    const file = join(dir, 'a.ts')
    writeFileSync(file, "getBooleanValue('a.expired', false)\n")
    const result = lintRegistry({
      registry: defineFlags({
        'a.expired': {
          ...baseDef,
          createdAt: '2024-01-01',
          expiresAt: '2025-01-01',
        },
      }),
      sourceFiles: [file],
      asOf: '2026-04-25',
    })
    expect(result.expired).toEqual([
      { name: 'a.expired', expiresAt: '2025-01-01' },
    ])
  })

  it('flags dead flags (registry but no code reference)', () => {
    const dir = tmp()
    const file = join(dir, 'a.ts')
    writeFileSync(file, '// no flag references\n')
    const result = lintRegistry({
      registry: defineFlags({ 'a.live': baseDef }),
      sourceFiles: [file],
      asOf: '2026-04-25',
    })
    expect(result.dead).toEqual(['a.live'])
  })

  it('flags undeclared references', () => {
    const dir = tmp()
    const file = join(dir, 'a.ts')
    writeFileSync(file, "getBooleanValue('a.unknown', false)\n")
    const result = lintRegistry({
      registry: defineFlags({}),
      sourceFiles: [file],
      asOf: '2026-04-25',
    })
    expect(result.undeclared.map((u) => u.name)).toEqual(['a.unknown'])
  })

  it('archived flags suppress undeclared lint', () => {
    const dir = tmp()
    const file = join(dir, 'a.ts')
    writeFileSync(file, "getBooleanValue('a.archived', false)\n")
    const result = lintRegistry({
      registry: defineFlags({}),
      sourceFiles: [file],
      archivedFlags: ['a.archived'],
      asOf: '2026-04-25',
    })
    expect(result.undeclared).toEqual([])
  })

  it('clean registry has no issues', () => {
    const dir = tmp()
    const file = join(dir, 'a.ts')
    writeFileSync(file, "getBooleanValue('a.live', false)\n")
    const result = lintRegistry({
      registry: defineFlags({ 'a.live': baseDef }),
      sourceFiles: [file],
      asOf: '2026-04-25',
    })
    expect(hasIssues(result)).toBe(false)
  })

  it('detects useFlag references', () => {
    const dir = tmp()
    const file = join(dir, 'a.tsx')
    writeFileSync(file, "useFlag('a.live', false)\n")
    const result = lintRegistry({
      registry: defineFlags({ 'a.live': baseDef }),
      sourceFiles: [file],
      asOf: '2026-04-25',
    })
    expect(hasIssues(result)).toBe(false)
  })
})
