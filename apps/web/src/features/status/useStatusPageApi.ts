import { useQuery } from '@tanstack/react-query'

import type { BetterStackStatusResponse, ServiceKind } from './types'

function isValidResponse(data: unknown): data is BetterStackStatusResponse {
  return typeof data === 'object' && data !== null
}

function deriveKind(data: BetterStackStatusResponse): ServiceKind {
  const resources = data.resources ?? []
  const reports = data.status_reports ?? []

  if (reports.some((r) => r.status === 'maintenance')) return 'maintenance'
  if (resources.some((r) => r.status === 'down')) return 'down'
  if (resources.some((r) => r.status === 'degraded')) return 'degraded'
  if (resources.some((r) => r.status === 'maintenance')) return 'maintenance'
  return 'operational'
}

export function useStatusPageApi():
  | { kind: ServiceKind; detail?: string }
  | undefined {
  const apiUrl = import.meta.env['VITE_STATUS_API_URL'] as string | undefined

  const { data } = useQuery({
    queryKey: ['status-page-api'] as const,
    queryFn: async ({ signal }): Promise<BetterStackStatusResponse> => {
      const res = await fetch(`${apiUrl}/api/v1/status`, { signal })
      if (!res.ok) throw new Error(`Status API ${res.status}`)
      return res.json() as Promise<BetterStackStatusResponse>
    },
    enabled: Boolean(apiUrl),
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: false,
  })

  if (!data) return undefined
  if (!isValidResponse(data)) return undefined

  return { kind: deriveKind(data) }
}
