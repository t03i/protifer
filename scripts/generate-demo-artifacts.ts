#!/usr/bin/env bun
/**
 * Generate the static demo artifacts served from `apps/web/public/demo/`.
 *
 * For each input in `DEMO_ACCESSIONS ∪ DEMO_SEQUENCES`, this script submits
 * a prediction through the real API gateway under the pinned `SUITE_V1`
 * configuration, polls until completion, and writes:
 *
 *   apps/web/public/demo/<hash>/predictions.json   — `StoredPrediction`
 *   apps/web/public/demo/<hash>/meta.json          — `{ sequence, accession?, suite, generatedAt }`
 *   apps/web/public/demo/index.json                — accession→hash map + sequence list
 *
 * where `<hash>` is `computeSequenceHash(sequence).slice(0, 16)`. `suite` is the
 * `computeModelConfigHash(SUITE_V1.predictionModels)` identifier, which the
 * CI freshness check (`scripts/check-demo-artifacts-fresh.ts`) compares against
 * the current configuration to detect stale artifacts.
 *
 * Prerequisites
 * -------------
 *   - The dev stack is running: `cd infra && docker compose -f docker-compose.dev.yml up`
 *     (gateway + workers + Triton + Redis + Garage must all be healthy).
 *   - An API key for an authenticated user is available as `DEMO_GENERATOR_API_KEY`
 *     (issue one via Settings → API Keys in the running app, or via
 *     `auth.api.createApiKey` server-side).
 *
 * Usage
 * -----
 *   DEMO_GENERATOR_API_KEY=<key> bun scripts/generate-demo-artifacts.ts
 *   DEMO_GENERATOR_API_KEY=<key> API_BASE_URL=http://localhost:9090 bun scripts/generate-demo-artifacts.ts
 *
 * When to re-run
 * --------------
 *   - After any change to `SUITE_V1` (`services/api-gateway/src/config/suites.ts`).
 *   - After any change to `DEMO_ACCESSIONS` / `DEMO_SEQUENCES` in
 *     `apps/web/src/lib/demo.ts`.
 *
 * The generated files are committed to the repo; regeneration is a reviewable
 * PR, not a CI step. See `openspec/changes/precompute-demo-artifacts/design.md`.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  computeModelConfigHash,
  computeSequenceHash,
  readConfig,
  readSecretOptional,
  StoredPredictionSchema,
} from '@protifer/shared'
import type { StoredPrediction } from '@protifer/shared'

// Kept in lockstep with `apps/web/src/lib/demo.ts`. Duplicated here rather than
// imported to keep the script independent of the web build.
const DEMO_ACCESSIONS = ['P04637', 'P38398', 'P12345'] as const
const DEMO_SEQUENCES = [
  'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKLVV',
] as const

const API_BASE_URL = readConfig('API_BASE_URL') ?? 'http://localhost:9090'
const API_KEY = readSecretOptional('DEMO_GENERATOR_API_KEY')
const POLL_INTERVAL_MS = 1_000
const POLL_TIMEOUT_MS = 5 * 60 * 1_000

const PUBLIC_DEMO_DIR = resolve(import.meta.dir, '..', 'apps/web/public/demo')

interface DemoInput {
  sequence: string
  accession?: string
}

interface SubmitResponse {
  jobId: string
  statusUrl: string
}

interface PollResponse {
  status: 'queued' | 'processing' | 'complete' | 'failed' | 'not_found'
  jobId?: string
  result?: unknown
  error?: string
}

interface ArtifactMeta {
  sequence: string
  accession?: string
  suite: string
  generatedAt: string
}

interface DemoIndex {
  accessions: Record<string, string>
  sequences: string[]
  suite: string
}

function authHeaders(): Record<string, string> {
  if (!API_KEY) {
    throw new Error(
      'DEMO_GENERATOR_API_KEY is not set. Issue an API key for an authenticated user and export it as DEMO_GENERATOR_API_KEY.',
    )
  }
  return { Authorization: `Bearer ${API_KEY}` }
}

async function submit(input: DemoInput): Promise<SubmitResponse> {
  const body: DemoInput = input.accession
    ? { sequence: input.sequence, accession: input.accession }
    : { sequence: input.sequence }
  const res = await fetch(`${API_BASE_URL}/v1/predictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(
      `Submit failed for ${input.accession ?? 'sequence'}: ${res.status} ${await res.text()}`,
    )
  }
  return (await res.json()) as SubmitResponse
}

async function poll(jobId: string): Promise<StoredPrediction> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const res = await fetch(`${API_BASE_URL}/v1/predictions/${jobId}`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      throw new Error(`Poll failed for ${jobId}: ${res.status}`)
    }
    const body = (await res.json()) as PollResponse
    if (body.status === 'complete' && body.result) {
      return StoredPredictionSchema.parse(body.result)
    }
    if (body.status === 'failed' || body.status === 'not_found') {
      throw new Error(
        `Job ${jobId} ended in status=${body.status} error=${body.error ?? 'n/a'}`,
      )
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`Job ${jobId} did not complete within ${POLL_TIMEOUT_MS}ms`)
}

export async function generateForInput(
  input: DemoInput,
  suiteHash: string,
): Promise<{ hash: string }> {
  const hash = computeSequenceHash(input.sequence).slice(0, 16)
  const dir = resolve(PUBLIC_DEMO_DIR, hash)
  await mkdir(dir, { recursive: true })

  const { jobId } = await submit(input)
  const prediction = await poll(jobId)

  await writeFile(
    resolve(dir, 'predictions.json'),
    `${JSON.stringify(prediction, null, 2)}\n`,
  )
  const meta: ArtifactMeta = {
    sequence: input.sequence,
    ...(input.accession ? { accession: input.accession } : {}),
    suite: suiteHash,
    generatedAt: new Date().toISOString(),
  }
  await writeFile(
    resolve(dir, 'meta.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
  )
  return { hash }
}

async function main(): Promise<void> {
  // Imported lazily so the script can run without the api-gateway workspace
  // being compiled into dist.
  const { buildSuiteV1 } =
    await import('../services/api-gateway/src/config/suites.ts')
  const { ConfigSchema, TEST_ENV } =
    await import('../services/api-gateway/src/config/schema.ts')
  const suite = buildSuiteV1(ConfigSchema.load(TEST_ENV).models)
  const suiteHash = computeModelConfigHash(suite.predictionModels)

  await mkdir(PUBLIC_DEMO_DIR, { recursive: true })

  const accessionMap: Record<string, string> = {}
  for (const accession of DEMO_ACCESSIONS) {
    console.log(`generating ${accession}…`)
    // The submit route requires the sequence, so resolve it via UniProt.
    const seq = await fetchUniprotSequence(accession)
    const { hash } = await generateForInput(
      { sequence: seq, accession },
      suiteHash,
    )
    accessionMap[accession] = hash
  }

  const sequences: string[] = []
  for (const sequence of DEMO_SEQUENCES) {
    console.log(`generating raw sequence ${sequence.slice(0, 12)}…`)
    await generateForInput({ sequence }, suiteHash)
    sequences.push(sequence)
  }

  const index: DemoIndex = {
    accessions: accessionMap,
    sequences,
    suite: suiteHash,
  }
  await writeFile(
    resolve(PUBLIC_DEMO_DIR, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  )
  console.log(`wrote index.json with suite=${suiteHash}`)
}

async function fetchUniprotSequence(accession: string): Promise<string> {
  const res = await fetch(
    `https://rest.uniprot.org/uniprotkb/${accession}.fasta`,
  )
  if (!res.ok) {
    throw new Error(
      `UniProt fetch failed for ${accession}: ${res.status} ${res.statusText}`,
    )
  }
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('>'))
    .join('')
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('generate-demo-artifacts failed:', err)
      process.exit(1)
    })
}
