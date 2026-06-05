import { queryOptions, useQuery } from '@tanstack/react-query'

import { PREDICTIONS_STALE_TIME } from '#/lib/query-config'
import { fetchUniRefMembers } from '#/services/api/uniref'
import type { UniRefIdentity } from '#/types/uniref'

function unirefQueryOptions(
  accession: string | undefined,
  identity: UniRefIdentity,
) {
  return queryOptions({
    queryKey: ['uniref', accession, identity] as const,
    queryFn: () => fetchUniRefMembers(accession!, identity),
    staleTime: PREDICTIONS_STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: !!accession,
  })
}

export function useUniRefClusters(accession: string | undefined) {
  const q100 = useQuery(unirefQueryOptions(accession, 100))
  const q90 = useQuery(unirefQueryOptions(accession, 90))
  const q50 = useQuery(unirefQueryOptions(accession, 50))
  return { q100, q90, q50 }
}
