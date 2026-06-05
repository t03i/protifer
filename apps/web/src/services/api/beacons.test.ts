import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchBeaconsSummary } from './beacons'
import { APIException } from './http'

import type { BeaconsSummary } from '#/types/structure'

let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

const SAMPLE: BeaconsSummary = {
  uniprot_entry: { ac: 'P05067', id: 'A4_HUMAN', sequence_length: 770 },
  structures: [
    {
      summary: {
        model_identifier: 'AF-P05067-F1',
        model_category: 'DEEP-LEARNING',
        provider: 'AlphaFold DB',
        model_url:
          'https://alphafold.ebi.ac.uk/files/AF-P05067-F1-model_v4.cif',
        model_format: 'mmCIF',
        confidence_avg: 82.3,
        coverage: 0.95,
        created: '2022-11-01',
        entities: [],
      },
    },
  ],
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchBeaconsSummary', () => {
  it('returns BeaconsSummary on 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE), { status: 200 }),
    )
    const result = await fetchBeaconsSummary('P05067')
    expect(result.uniprot_entry.ac).toBe('P05067')
    expect(result.structures).toHaveLength(1)
  })

  it('throws APIException(404) when accession has no structure', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(fetchBeaconsSummary('NOTREAL')).rejects.toBeInstanceOf(
      APIException,
    )
  })

  it('throws APIException on 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 500, statusText: 'Server Error' }),
    )
    await expect(fetchBeaconsSummary('P05067')).rejects.toBeInstanceOf(
      APIException,
    )
  })

  it('throws APIException when fetch rejects (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'))
    await expect(fetchBeaconsSummary('P05067')).rejects.toBeInstanceOf(
      APIException,
    )
  })

  it('throws ZodError when API response shape is invalid', async () => {
    const { ZodError } = await import('zod')
    const malformed = { uniprot_entry: { ac: 'P05067' } } // missing id, sequence_length, structures
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(malformed), { status: 200 }),
    )
    await expect(fetchBeaconsSummary('P05067')).rejects.toBeInstanceOf(ZodError)
  })

  it('parses successfully when entity identifier_category is null', async () => {
    const withNullCategory: BeaconsSummary = {
      ...SAMPLE,
      structures: [
        {
          summary: {
            ...SAMPLE.structures[0]!.summary,
            entities: [
              {
                entity_type: 'NON-POLYMER',
                identifier_category: null,
                description: 'SULFATE ION',
                chain_ids: ['A'],
              },
            ],
          },
        },
      ],
    }
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(withNullCategory), { status: 200 }),
    )
    const result = await fetchBeaconsSummary('P05067')
    expect(
      result.structures[0]!.summary.entities[0]!.identifier_category,
    ).toBeNull()
  })

  it('parses successfully when resolution and experimental_method are null', async () => {
    const withNulls = {
      ...SAMPLE,
      structures: [
        {
          summary: {
            ...SAMPLE.structures[0]!.summary,
            resolution: null,
            experimental_method: null,
          },
        },
      ],
    }
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(withNulls), { status: 200 }),
    )
    const result = await fetchBeaconsSummary('P05067')
    expect(result.structures[0]!.summary.resolution).toBeNull()
    expect(result.structures[0]!.summary.experimental_method).toBeNull()
  })
})
