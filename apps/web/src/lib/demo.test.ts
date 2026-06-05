// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEMO_ACCESSIONS,
  DEMO_SEQUENCES,
  __resetDemoIndexCacheForTests,
  getDemoArtifactPath,
  isDemoAccession,
  isDemoInput,
  isDemoSequence,
  loadDemoPrediction,
} from './demo'

const demoSequence = DEMO_SEQUENCES[0]
const demoAccession = DEMO_ACCESSIONS[0]

function mockFetchSequence(responses: Array<() => Response>): typeof fetch {
  let i = 0
  return ((..._args: Parameters<typeof fetch>) => {
    const make = responses[i++]
    if (!make) throw new Error('fetch called more times than mocked')
    return Promise.resolve(make())
  }) as unknown as typeof fetch
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
}

describe('isDemoInput', () => {
  it('returns true for a known demo accession', () => {
    expect(isDemoInput({ accession: demoAccession })).toBe(true)
  })

  it('returns true for a known demo sequence', () => {
    expect(isDemoInput({ sequence: demoSequence })).toBe(true)
  })

  it('returns false for an unknown accession', () => {
    expect(isDemoInput({ accession: 'Q99999' })).toBe(false)
  })

  it('returns false for an unknown sequence', () => {
    expect(isDemoInput({ sequence: 'MEEPQ' })).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(isDemoInput({})).toBe(false)
  })
})

describe('isDemoAccession / isDemoSequence', () => {
  it('type-guards demo accessions', () => {
    expect(isDemoAccession(demoAccession)).toBe(true)
    expect(isDemoAccession('NOT_DEMO')).toBe(false)
  })
  it('type-guards demo sequences', () => {
    expect(isDemoSequence(demoSequence)).toBe(true)
    expect(isDemoSequence('MEEPQ')).toBe(false)
  })
})

describe('getDemoArtifactPath', () => {
  it('builds the public-asset URL', () => {
    expect(getDemoArtifactPath('abc123')).toBe('/demo/abc123/predictions.json')
  })
})

describe('loadDemoPrediction', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    __resetDemoIndexCacheForTests()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('resolves an accession by looking up the index hash', async () => {
    const storedPrediction = {
      schemaVersion: 2,
      versions: [{ name: 'seth', version: '1' }],
      outputs: { seth: [0.1, 0.2] },
    }
    globalThis.fetch = mockFetchSequence([
      () =>
        jsonResponse({
          accessions: { [demoAccession]: 'cafebabe00000000' },
          sequences: [],
          suite: 'suite-hash',
        }),
      () => jsonResponse(storedPrediction),
    ])

    const result = await loadDemoPrediction({ accession: demoAccession })
    expect(result).toEqual(storedPrediction)
  })

  it('throws if the accession has no entry in the index', async () => {
    globalThis.fetch = mockFetchSequence([
      () =>
        jsonResponse({ accessions: {}, sequences: [], suite: 'suite-hash' }),
    ])

    await expect(
      loadDemoPrediction({ accession: demoAccession }),
    ).rejects.toThrow(/no demo artifact/)
  })

  it('resolves a demo sequence via computed hash', async () => {
    const storedPrediction = {
      schemaVersion: 2,
      versions: [],
      outputs: {},
    }
    globalThis.fetch = mockFetchSequence([
      () =>
        jsonResponse({
          accessions: {},
          sequences: [demoSequence],
          suite: 'suite-hash',
        }),
      () => jsonResponse(storedPrediction),
    ])
    const result = await loadDemoPrediction({ sequence: demoSequence })
    expect(result).toEqual(storedPrediction)
  })

  it('throws on non-ok artifact response', async () => {
    globalThis.fetch = mockFetchSequence([
      () =>
        jsonResponse({
          accessions: { [demoAccession]: 'cafebabe00000000' },
          sequences: [],
          suite: 'suite-hash',
        }),
      () => new Response('not found', { status: 404 }),
    ])

    await expect(
      loadDemoPrediction({ accession: demoAccession }),
    ).rejects.toThrow(/404/)
  })
})
