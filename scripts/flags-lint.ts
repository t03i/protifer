#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  FLAG_REGISTRY,
  formatLintResult,
  hasIssues,
  lintRegistry,
} from '@protifer/shared'

const REPO_ROOT = process.cwd()
const ARCHIVED_PATH = join(REPO_ROOT, 'archived-flags.json')

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (
      e === 'node_modules' ||
      e === 'dist' ||
      e === '.turbo' ||
      e === '.next' ||
      e === '.git' ||
      e === 'openspec'
    )
      continue
    const path = join(dir, e)
    const st = statSync(path)
    if (st.isDirectory()) walk(path, out)
    else if (
      /\.(ts|tsx|js|mjs|cjs)$/.test(e) &&
      !e.endsWith('.test.ts') &&
      !e.endsWith('.test.tsx') &&
      !path.includes('packages/shared/src/flags/')
    ) {
      out.push(path)
    }
  }
  return out
}

let archivedFlags: string[] = []
if (existsSync(ARCHIVED_PATH)) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(ARCHIVED_PATH, 'utf8'))
    if (Array.isArray(parsed))
      archivedFlags = parsed.filter((x): x is string => typeof x === 'string')
  } catch (err) {
    console.error(`Failed to parse ${ARCHIVED_PATH}:`, err)
    process.exit(2)
  }
}

const sourceFiles = walk(REPO_ROOT)
const result = lintRegistry({
  registry: FLAG_REGISTRY,
  sourceFiles,
  archivedFlags,
})

if (hasIssues(result)) {
  console.error('Feature flag lint failed:\n')
  console.error(formatLintResult(result))
  console.error('')
  for (const u of result.undeclared) {
    for (const loc of u.locations)
      console.error(`  ${relative(REPO_ROOT, loc)}`)
  }
  process.exit(1)
}

console.log(
  `flags:lint OK — ${Object.keys(FLAG_REGISTRY).length} flag(s), ${sourceFiles.length} source file(s) scanned.`,
)
