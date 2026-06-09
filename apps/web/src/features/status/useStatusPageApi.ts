import { useQuery } from '@tanstack/react-query'

import type { BetterStackStatusResponse, ServiceKind } from './types'

function isValidResponse(data: unknown): data is BetterStackStatusResponse {
  return typeof data === 'object' && data !== null
}

function deriveKind(data: BetterStackStatusResponse): ServiceKind | undefined {
  switch (data.data?.attributes?.aggregate_state) {
    case 'operational':
      return 'operational'
    case 'degraded':
      return 'degraded'
    case 'downtime':
      return 'down'
    case 'maintenance':
      return 'maintenance'
    default:
      return undefined
  }
}

export function useStatusPageApi():
  | { kind: ServiceKind; detail?: string }
  | undefined {
  const statusPageUrl = import.meta.env['VITE_STATUS_PAGE_URL'] as
    | string
    | undefined

  const { data } = useQuery({
    queryKey: ['status-page-api'] as const,
    queryFn: async ({ signal }): Promise<BetterStackStatusResponse> => {
      const res = await fetch(`${statusPageUrl}/index.json`, { signal })
      if (!res.ok) throw new Error(`Status API ${res.status}`)
      return res.json() as Promise<BetterStackStatusResponse>
    },
    enabled: Boolean(statusPageUrl),
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: false,
  })

  if (!data || !isValidResponse(data)) return undefined

  const kind = deriveKind(data)
  if (!kind) return undefined

  return { kind }
}
