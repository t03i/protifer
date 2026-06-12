import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchSequenceById, fetchSequenceByName } from './uniprot'

let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchSequenceById', () => {
  it('returns sequence and accession for valid ID', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          primaryAccession: 'P12345',
          sequence: { value: 'MKTAYIAKQR' },
        }),
        { status: 200 },
      ),
    )

    const result = await fetchSequenceById('P12345')
    expect(result.accession).toBe('P12345')
    expect(result.sequence).toBe('MKTAYIAKQR')
  })

  it('throws SequenceException on 404', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 404 }))

    await expect(fetchSequenceById('XXXXX')).rejects.toThrow(
      'Could not find a sequence',
    )
  })

  it('throws SequenceException (not TypeError) for an inactive/deleted entry with no sequence', async () => {
    // UniProt returns HTTP 200 with no `sequence` field for obsolete entries.
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entryType: 'Inactive',
          primaryAccession: 'A0A654IBU3',
          inactiveReason: { inactiveReasonType: 'DELETED' },
        }),
        { status: 200 },
      ),
    )

    await expect(fetchSequenceById('A0A654IBU3')).rejects.toThrow('no sequence')
  })
})

describe('fetchSequenceByName', () => {
  it('returns first search result', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              primaryAccession: 'P12345',
              sequence: { value: 'MKTAYIAKQR' },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await fetchSequenceByName('HEMOA_HUMAN')
    expect(result.accession).toBe('P12345')
  })

  it('throws when no results found', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    )

    await expect(fetchSequenceByName('NONEXIST_HUMAN')).rejects.toThrow(
      'Could not find a protein',
    )
  })
})
