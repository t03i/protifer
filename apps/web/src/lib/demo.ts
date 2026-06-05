import type { StoredPrediction } from '@protifer/shared'

export const DEMO_ACCESSIONS = ['P04637', 'P38398', 'P12345'] as const
export type DemoAccession = (typeof DEMO_ACCESSIONS)[number]

export const DEMO_SEQUENCES = [
  'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKLVV',
] as const
export type DemoSequence = (typeof DEMO_SEQUENCES)[number]

interface DemoIndex {
  accessions: Record<string, string>
  sequences: string[]
  suite: string
}

let indexPromise: Promise<DemoIndex> | null = null

function loadDemoIndex(): Promise<DemoIndex> {
  if (!indexPromise) {
    indexPromise = fetch('/demo/index.json').then(async (res) => {
      if (!res.ok) throw new Error(`demo index fetch failed: ${res.status}`)
      return (await res.json()) as DemoIndex
    })
  }
  return indexPromise
}

export function isDemoAccession(accession: string): accession is DemoAccession {
  return (DEMO_ACCESSIONS as readonly string[]).includes(accession)
}

export function isDemoSequence(sequence: string): sequence is DemoSequence {
  return (DEMO_SEQUENCES as readonly string[]).includes(sequence)
}

export function isDemoInput(input: {
  accession?: string | undefined
  sequence?: string | undefined
}): boolean {
  if (input.accession && isDemoAccession(input.accession)) return true
  if (input.sequence && isDemoSequence(input.sequence)) return true
  return false
}

export function getDemoArtifactPath(hash: string): string {
  return `/demo/${hash}/predictions.json`
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function loadDemoPrediction(input: {
  accession?: string | undefined
  sequence?: string | undefined
}): Promise<StoredPrediction> {
  const index = await loadDemoIndex()
  let hash: string | undefined
  if (input.accession && isDemoAccession(input.accession)) {
    hash = index.accessions[input.accession]
  } else if (input.sequence && isDemoSequence(input.sequence)) {
    hash = (await sha256Hex(input.sequence)).slice(0, 16)
  }
  if (!hash) {
    throw new Error(
      `no demo artifact for input: ${JSON.stringify({
        accession: input.accession,
        sequence: input.sequence?.slice(0, 24),
      })}`,
    )
  }
  const res = await fetch(getDemoArtifactPath(hash))
  if (!res.ok) {
    throw new Error(
      `demo artifact fetch failed for hash=${hash}: ${res.status}`,
    )
  }
  return (await res.json()) as StoredPrediction
}

/** Test-only: reset the cached index Promise so tests can swap fetch impls. */
export function __resetDemoIndexCacheForTests(): void {
  indexPromise = null
}
