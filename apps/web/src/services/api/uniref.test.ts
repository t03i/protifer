import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APIException } from './http'
import { fetchUniRefMembers } from './uniref'

let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

const SAMPLE_RESPONSE = {
  memberCount: 2,
  members: [
    {
      memberId: 'P05067_HUMAN',
      memberIdType: 'UniProtKB ID',
      proteinName: 'Amyloid precursor protein',
      organism: { scientificName: 'Homo sapiens', commonName: 'Human' },
      accessions: ['P05067'],
    },
    {
      memberId: 'Q02388_MOUSE',
      memberIdType: 'UniProtKB ID',
      proteinName: 'Amyloid precursor protein',
      organism: { scientificName: 'Mus musculus', commonName: 'Mouse' },
      accessions: ['Q02388'],
    },
  ],
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchUniRefMembers', () => {
  it('returns mapped members on 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_RESPONSE), { status: 200 }),
    )
    const members = await fetchUniRefMembers('P05067', 100)
    expect(members).toHaveLength(2)
    expect(members[0]!.accession).toBe('P05067')
    expect(members[0]!.unirefCluster).toBe('UniRef100_P05067')
  })

  it('returns empty array on 404 (no cluster at this identity level)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 404 }))
    const members = await fetchUniRefMembers('P05067', 50)
    expect(members).toEqual([])
  })

  it('throws APIException on 500', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 500, statusText: 'Error' }),
    )
    await expect(fetchUniRefMembers('P05067', 100)).rejects.toBeInstanceOf(
      APIException,
    )
  })

  it('constructs the correct cluster name per identity level', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ memberCount: 0, members: [] }), {
        status: 200,
      }),
    )
    await fetchUniRefMembers('P05067', 90)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('UniRef90_P05067'),
      expect.anything(),
    )
  })
})
