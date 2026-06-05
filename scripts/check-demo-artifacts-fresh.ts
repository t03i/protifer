#!/usr/bin/env bun
/**
 * CI guard: fail if the checked-in demo artifacts under `apps/web/public/demo/`
 * were generated against a `SUITE_V1` configuration that no longer matches the
 * current one.
 *
 * Reads each `apps/web/public/demo/<hash>/meta.json`, compares `meta.suite`
 * against `computeModelConfigHash(SUITE_V1.predictionModels)`, and exits
 * non-zero on any mismatch — naming the stale artifact(s) and pointing to the
 * generator script.
 *
 * Also asserts the on-disk layout matches `apps/web/public/demo/index.json`:
 * every indexed hash has a directory, every directory is referenced, and the
 * index's `suite` field equals the computed one.
 *
 * Usage: `bun scripts/check-demo-artifacts-fresh.ts` (invoked by the top-level
 * `check:demo-artifacts` script and the CI pipeline).
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { computeModelConfigHash } from '@protifer/shared'

const PUBLIC_DEMO_DIR = resolve(import.meta.dir, '..', 'apps/web/public/demo')

interface MetaJson {
  sequence: string
  accession?: string
  suite: string
  generatedAt: string
}

interface IndexJson {
  accessions: Record<string, string>
  sequences: string[]
  suite: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as T
}

export async function checkDemoArtifactsFresh(): Promise<{
  stale: string[]
  indexIssues: string[]
}> {
  const { buildSuiteV1 } =
    await import('../services/api-gateway/src/config/suites.ts')
  const { ConfigSchema, TEST_ENV } =
    await import('../services/api-gateway/src/config/schema.ts')
  const suite = buildSuiteV1(ConfigSchema.load(TEST_ENV).models)
  const currentSuite = computeModelConfigHash(suite.predictionModels)

  const indexPath = resolve(PUBLIC_DEMO_DIR, 'index.json')
  if (!(await exists(indexPath))) {
    return {
      stale: [],
      indexIssues: [
        `${indexPath} is missing — run scripts/generate-demo-artifacts.ts to create the demo artifact set.`,
      ],
    }
  }

  const index = await readJson<IndexJson>(indexPath)
  const indexIssues: string[] = []
  const stale: string[] = []

  if (index.suite !== currentSuite) {
    indexIssues.push(
      `index.json suite=${index.suite} does not match current SUITE_V1 hash ${currentSuite}`,
    )
  }

  const indexedHashes = new Set<string>(Object.values(index.accessions))
  const entries = await readdir(PUBLIC_DEMO_DIR, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const metaPath = resolve(PUBLIC_DEMO_DIR, entry.name, 'meta.json')
    if (!(await exists(metaPath))) {
      indexIssues.push(`${entry.name}/ has no meta.json`)
      continue
    }
    const meta = await readJson<MetaJson>(metaPath)
    if (meta.suite !== currentSuite) {
      stale.push(
        `${entry.name} (accession=${meta.accession ?? 'n/a'}): meta.suite=${meta.suite} expected ${currentSuite}`,
      )
    }
    // Hashes that correspond to raw-sequence inputs won't appear in
    // `accessions`. Reconstruct them from `sequences` and skip.
    const isSequenceHash = index.sequences.some(
      (s) => hashShort(s) === entry.name,
    )
    if (!indexedHashes.has(entry.name) && !isSequenceHash) {
      indexIssues.push(
        `${entry.name}/ exists on disk but is not referenced by index.json`,
      )
    }
  }

  for (const hash of indexedHashes) {
    const dir = resolve(PUBLIC_DEMO_DIR, hash)
    if (!(await exists(dir))) {
      indexIssues.push(
        `index.json references hash ${hash} but ${dir} does not exist`,
      )
    }
  }

  return { stale, indexIssues }
}

function hashShort(sequence: string): string {
  return createHash('sha256').update(sequence).digest('hex').slice(0, 16)
}

if (import.meta.main) {
  checkDemoArtifactsFresh()
    .then(({ stale, indexIssues }) => {
      if (stale.length === 0 && indexIssues.length === 0) {
        console.log('demo artifacts are fresh')
        process.exit(0)
      }
      if (stale.length > 0) {
        console.error('stale demo artifacts detected:')
        for (const s of stale) console.error(`  - ${s}`)
      }
      if (indexIssues.length > 0) {
        console.error('demo artifact index issues:')
        for (const s of indexIssues) console.error(`  - ${s}`)
      }
      console.error('\nRegenerate with: bun scripts/generate-demo-artifacts.ts')
      process.exit(1)
    })
    .catch((err: unknown) => {
      console.error('check-demo-artifacts-fresh failed:', err)
      process.exit(1)
    })
}
