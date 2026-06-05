import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ReactNode } from 'react'

import { FeatureFlagsProvider } from './provider'

import { useAuthContext } from '#/features/auth/context'

const STALE_TIME_MS = 30_000

// No `useFlag` call sites exist yet, so polling `/v1/flags/me` buys nothing.
// Flip to `true` alongside the first `useFlag` consumer to enable evaluation.
const HAS_FLAG_CONSUMERS = false

interface FlagsMeResponse {
  evaluatedFlags: Record<string, unknown>
}

async function fetchEvaluatedFlags(): Promise<FlagsMeResponse> {
  const res = await fetch('/v1/flags/me', { credentials: 'include' })
  if (!res.ok) return { evaluatedFlags: {} }
  return (await res.json()) as FlagsMeResponse
}

export function FeatureFlagsMount({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthContext()
  const { data } = useQuery({
    queryKey: ['flags', 'me'],
    queryFn: fetchEvaluatedFlags,
    enabled: isAuthenticated && HAS_FLAG_CONSUMERS,
    staleTime: STALE_TIME_MS,
    refetchInterval: STALE_TIME_MS,
  })

  const evaluatedFlags = useMemo(() => data?.evaluatedFlags ?? {}, [data])

  return (
    <FeatureFlagsProvider evaluatedFlags={evaluatedFlags}>
      {children}
    </FeatureFlagsProvider>
  )
}
