// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { useConnectionHealth } from './useConnectionHealth'

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

function fireQueryEvent(
  queryClient: QueryClient,
  status: 'error' | 'success',
  count = 1,
) {
  const cache = queryClient.getQueryCache()
  for (let i = 0; i < count; i++) {
    const query = cache.build(queryClient, {
      queryKey: [`test-${status}-${i}-${Date.now()}-${Math.random()}`],
      queryFn: () => Promise.resolve('ok'),
    })
    // setState triggers internal cache.notify — do not call notify again
    if (status === 'error') {
      query.setState({
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('fail'),
        data: undefined,
      })
    } else {
      query.setState({
        status: 'success',
        fetchStatus: 'idle',
        error: null,
        data: 'ok',
      })
    }
  }
}

describe('useConnectionHealth', () => {
  it('starts as ok', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useConnectionHealth(), {
      wrapper: wrapper(queryClient),
    })
    expect(result.current).toBe('ok')
  })

  it('stays ok with fewer than 3 errors', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useConnectionHealth(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      fireQueryEvent(queryClient, 'error', 2)
    })

    expect(result.current).toBe('ok')
  })

  it('transitions to lost after 3 errors within window', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useConnectionHealth(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      fireQueryEvent(queryClient, 'error', 3)
    })

    expect(result.current).toBe('lost')
  })

  it('ignores errors from the external status-page-api query', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useConnectionHealth(), {
      wrapper: wrapper(queryClient),
    })

    const cache = queryClient.getQueryCache()
    act(() => {
      for (let i = 0; i < 5; i++) {
        const query = cache.build(queryClient, {
          queryKey: ['status-page-api'],
          queryFn: () => Promise.resolve('ok'),
        })
        query.setState({
          status: 'error',
          fetchStatus: 'idle',
          error: new Error('BetterStack slow'),
          data: undefined,
        })
      }
    })

    expect(result.current).toBe('ok')
  })

  it('recovers to ok on success after being lost', () => {
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useConnectionHealth(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      fireQueryEvent(queryClient, 'error', 3)
    })
    expect(result.current).toBe('lost')

    act(() => {
      fireQueryEvent(queryClient, 'success', 1)
    })
    expect(result.current).toBe('ok')
  })
})
