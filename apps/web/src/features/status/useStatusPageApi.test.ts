// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useStatusPageApi } from './useStatusPageApi'

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useStatusPageApi', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns undefined and makes no fetch when VITE_STATUS_API_URL is unset', () => {
    vi.stubEnv('VITE_STATUS_API_URL', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const queryClient = new QueryClient()

    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    expect(result.current).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns operational when all resources are operational', async () => {
    vi.stubEnv('VITE_STATUS_API_URL', 'https://betteruptime.com')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resources: [{ id: '1', status: 'operational' }],
          status_reports: [],
        }),
        { status: 200 },
      ),
    )

    const queryClient = new QueryClient()
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current?.kind).toBe('operational')
  })

  it('returns degraded when any resource is degraded', async () => {
    vi.stubEnv('VITE_STATUS_API_URL', 'https://betteruptime.com')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resources: [
            { id: '1', status: 'operational' },
            { id: '2', status: 'degraded' },
          ],
          status_reports: [],
        }),
        { status: 200 },
      ),
    )

    const queryClient = new QueryClient()
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current?.kind).toBe('degraded')
  })

  it('returns maintenance when a status report has status maintenance', async () => {
    vi.stubEnv('VITE_STATUS_API_URL', 'https://betteruptime.com')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resources: [{ id: '1', status: 'operational' }],
          status_reports: [
            { id: '99', status: 'maintenance', message: 'Planned window' },
          ],
        }),
        { status: 200 },
      ),
    )

    const queryClient = new QueryClient()
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current?.kind).toBe('maintenance')
  })

  it('returns undefined (no crash) when the status API is unreachable', async () => {
    vi.stubEnv('VITE_STATUS_API_URL', 'https://betteruptime.com')
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Network error'),
    )

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    // After fetch failure with retry:false, the hook returns undefined gracefully (no crash).
    await waitFor(() => {
      expect(result.current).toBeUndefined()
    })
  })
})
