import { useQuery } from '@tanstack/react-query'

import type { BetterStackStatusResponse, ServiceKind } from './types'

export const STATUS_PAGE_QUERY_KEY = ['status-page-api'] as const

// Cache long and hold last-good so a slow BetterStack fetch never flips the indicator.
const STATUS_CACHE_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 10_000

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
    queryKey: STATUS_PAGE_QUERY_KEY,
    queryFn: async ({ signal }): Promise<BetterStackStatusResponse> => {
      const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
      const res = await fetch(`${statusPageUrl}/index.json`, {
        signal: AbortSignal.any([signal, timeout]),
      })
      if (!res.ok) throw new Error(`Status API ${res.status}`)
      return res.json() as Promise<BetterStackStatusResponse>
    },
    enabled: Boolean(statusPageUrl),
    refetchInterval: STATUS_CACHE_MS,
    staleTime: STATUS_CACHE_MS,
    gcTime: Infinity,
    retry: 2,
  })

  if (!data || !isValidResponse(data)) return undefined

  const kind = deriveKind(data)
  if (!kind) return undefined

  return { kind }
}
