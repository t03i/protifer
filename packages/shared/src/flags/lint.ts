import { readFileSync } from 'node:fs'

import type { FlagRegistry } from './types.ts'

export interface LintResult {
  expired: { name: string; expiresAt: string }[]
  dead: string[]
  undeclared: { name: string; locations: string[] }[]
}

export interface LintOptions {
  registry: FlagRegistry
  sourceFiles: string[]
  archivedFlags?: readonly string[]
  /** ISO date used as "today" for expiry comparisons. Defaults to today. */
  asOf?: string
}

const RESOLVE_RE =
  /get(?:Boolean|String|Number|Object)Value\s*\(\s*['"]([^'"]+)['"]/g
const USE_FLAG_RE =
  /useFlag\s*<[^>]*>\s*\(\s*['"]([^'"]+)['"]|useFlag\s*\(\s*['"]([^'"]+)['"]/g

export function lintRegistry(opts: LintOptions): LintResult {
  const today = opts.asOf ?? new Date().toISOString().slice(0, 10)
  const archived = new Set(opts.archivedFlags ?? [])
  const registryNames = new Set(Object.keys(opts.registry))

  const expired: LintResult['expired'] = []
  for (const [name, def] of Object.entries(opts.registry)) {
    if (def.expiresAt < today) {
      expired.push({ name, expiresAt: def.expiresAt })
    }
  }

  const referenceLocations = new Map<string, string[]>()
  for (const file of opts.sourceFiles) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const re of [RESOLVE_RE, USE_FLAG_RE]) {
      re.lastIndex = 0
      let match
      while ((match = re.exec(text)) !== null) {
        const name = match[1] ?? match[2]
        if (!name) continue
        const list = referenceLocations.get(name) ?? []
        list.push(file)
        referenceLocations.set(name, list)
      }
    }
  }

  const referencedNames = new Set(referenceLocations.keys())
  const dead: string[] = []
  for (const name of registryNames) {
    if (!referencedNames.has(name)) dead.push(name)
  }

  const undeclared: LintResult['undeclared'] = []
  for (const [name, locations] of referenceLocations.entries()) {
    if (registryNames.has(name) || archived.has(name)) continue
    undeclared.push({ name, locations: Array.from(new Set(locations)) })
  }

  return { expired, dead, undeclared }
}

export function hasIssues(result: LintResult): boolean {
  return (
    result.expired.length > 0 ||
    result.dead.length > 0 ||
    result.undeclared.length > 0
  )
}

export function formatLintResult(result: LintResult): string {
  const lines: string[] = []
  if (result.expired.length > 0) {
    lines.push('Expired flags (remove from registry):')
    for (const e of result.expired) {
      lines.push(`  • ${e.name} (expired ${e.expiresAt})`)
    }
  }
  if (result.dead.length > 0) {
    lines.push('Dead flags (in registry, no code reference):')
    for (const name of result.dead) lines.push(`  • ${name}`)
  }
  if (result.undeclared.length > 0) {
    lines.push('Undeclared flags (referenced in code, missing from registry):')
    for (const u of result.undeclared) {
      lines.push(`  • ${u.name}`)
      for (const loc of u.locations) lines.push(`      ${loc}`)
    }
  }
  return lines.join('\n')
}
