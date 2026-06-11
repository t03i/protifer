import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '#/services/api/gateway/client'

/**
 * Reads the gateway build SHA from /health. Single fetch on mount; the SHA only
 * changes on redeploy, so a long staleTime avoids polling. Failures resolve to
 * `undefined` (no retry) and are treated as 'unknown' skew, never an error.
 */
export function useGatewayVersion() {
  return useQuery({
    queryKey: ['gateway-version'],
    queryFn: async (): Promise<string | undefined> => {
      const res = await apiFetch('/health')
      if (!res.ok) return undefined
      const body = (await res.json()) as { sha?: string }
      return body.sha
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}
