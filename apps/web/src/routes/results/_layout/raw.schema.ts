import { RE_ACCESSION } from '#/services/sequence/validation'

export interface RawSearch {
  sequence?: string
  accession?: string
  model?: string
}

export function validateRawSearch(search: Record<string, unknown>): RawSearch {
  const accession =
    typeof search.accession === 'string' && RE_ACCESSION.test(search.accession)
      ? search.accession
      : undefined
  return {
    sequence: typeof search.sequence === 'string' ? search.sequence : undefined,
    accession,
    model: typeof search.model === 'string' ? search.model : undefined,
  }
}
