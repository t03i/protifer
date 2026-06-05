import { queryOptions, useQuery } from '@tanstack/react-query'

import { PREDICTIONS_STALE_TIME } from '#/lib/query-config'
import { fetchBeaconsSummary } from '#/services/api/beacons'

export function structureQueryOptions(accession: string | undefined) {
  return queryOptions({
    queryKey: ['structure', accession] as const,
    queryFn: () => fetchBeaconsSummary(accession!),
    staleTime: PREDICTIONS_STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: !!accession,
  })
}

export function useStructure(accession: string | undefined) {
  return useQuery(structureQueryOptions(accession))
}
