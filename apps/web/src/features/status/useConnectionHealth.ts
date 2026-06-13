import { useQueryClient } from '@tanstack/react-query'
import type { QueryCacheNotifyEvent } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { STATUS_PAGE_QUERY_KEY } from './useStatusPageApi'

// Emit 'lost' after ERROR_THRESHOLD errors with no success within WINDOW_MS
const ERROR_THRESHOLD = 3
const WINDOW_MS = 30_000

export type ConnectionHealth = 'ok' | 'lost'

export function useConnectionHealth(): ConnectionHealth {
  const queryClient = useQueryClient()
  const [health, setHealth] = useState<ConnectionHealth>('ok')

  // Recent error timestamps; reset on any success.
  const errorTimestamps = useRef<number[]>([])

  useEffect(() => {
    const cache = queryClient.getQueryCache()

    const unsubscribe = cache.subscribe((event: QueryCacheNotifyEvent) => {
      if (event.type !== 'updated') return

      // The external BetterStack status fetch must not drive our own
      // connection-lost signal — its slowness is not our backend going down.
      if (event.query.queryKey[0] === STATUS_PAGE_QUERY_KEY[0]) return

      const state = event.query.state

      if (state.status === 'error') {
        const now = Date.now()
        errorTimestamps.current.push(now)
        // Keep only errors within the window
        errorTimestamps.current = errorTimestamps.current.filter(
          (t) => now - t <= WINDOW_MS,
        )
        if (errorTimestamps.current.length >= ERROR_THRESHOLD) {
          setHealth('lost')
        }
      } else if (state.status === 'success') {
        errorTimestamps.current = []
        setHealth('ok')
      }
    })

    return unsubscribe
  }, [queryClient])

  return health
}
