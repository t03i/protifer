import { z } from 'zod'

import { APIException, fetchWithTimeout } from './http'

export const BeaconsEntitySchema = z.object({
  entity_type: z.string(),
  identifier_category: z.string().nullish(),
  description: z.string().optional(),
  chain_ids: z.array(z.string()).optional(),
})

export const BeaconsStructureSchema = z.object({
  model_identifier: z.string(),
  model_category: z.string(), // z.string() — NOT z.enum(). Live AlphaFold uses 'DEEP-LEARNING'
  provider: z.string(),
  model_url: z.string(),
  model_format: z.string().optional(),
  model_page_url: z.string().optional(),
  confidence_avg: z.number().optional(),
  sequence_identity: z.number().optional(),
  coverage: z.number().optional(),
  uniprot_start: z.number().optional(),
  uniprot_end: z.number().optional(),
  experimental_method: z.string().nullish(),
  resolution: z.number().nullish(),
  created: z.string(),
  entities: z.array(BeaconsEntitySchema),
})

export const BeaconsSummarySchema = z.object({
  uniprot_entry: z.object({
    ac: z.string(),
    id: z.string(),
    sequence_length: z.number(),
  }),
  structures: z.array(z.object({ summary: BeaconsStructureSchema })),
})

export type BeaconsSummary = z.infer<typeof BeaconsSummarySchema>
export type BeaconsStructure = z.infer<typeof BeaconsStructureSchema>
export type BeaconsEntity = z.infer<typeof BeaconsEntitySchema>

const BEACONS_BASE =
  'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary'

export async function fetchBeaconsSummary(
  accession: string,
): Promise<BeaconsSummary> {
  const url = `${BEACONS_BASE}/${accession.trim()}.json`

  const response = await fetchWithTimeout(url, { timeout: 15000 }).catch(() => {
    throw new APIException(`3D Beacons unreachable for ${accession}`, 0)
  })

  if (response.status === 404) {
    throw new APIException(`No structure found for ${accession}`, 404)
  }

  if (!response.ok) {
    throw new APIException(
      `3D Beacons error: ${response.statusText}`,
      response.status,
    )
  }

  const raw = await response.json()
  return BeaconsSummarySchema.parse(raw)
}
