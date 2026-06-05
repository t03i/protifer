import { queryOptions, useQuery } from '@tanstack/react-query'

import { PREDICTIONS_STALE_TIME } from '#/lib/query-config'
import { fetchSequenceById, fetchSequenceByName } from '#/services/api/uniprot'
import { parseFasta, parseResidue } from '#/services/sequence/parser'
import type { InputType, SequenceResult } from '#/types/sequence'

export function sequenceQueryOptions(inputType: InputType, input: string) {
  return queryOptions({
    queryKey: ['sequence', inputType, input] as const,
    queryFn: () => resolveSequence(inputType, input),
    staleTime: PREDICTIONS_STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 2,
    enabled: false,
  })
}

async function resolveSequence(
  inputType: InputType,
  input: string,
): Promise<SequenceResult> {
  switch (inputType) {
    case 'fasta':
      return parseFasta(input)
    case 'uniprot_id':
      return fetchSequenceById(input)
    case 'uniprot_protein_name':
      return fetchSequenceByName(input)
    case 'residue':
      return { sequence: parseResidue(input), accession: undefined }
    default:
      throw new Error(`Invalid input type: ${inputType}`)
  }
}

export function useSequence(inputType: InputType, input: string) {
  return useQuery(sequenceQueryOptions(inputType, input))
}
