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

function statusJson(aggregate_state: string) {
  return new Response(
    JSON.stringify({
      data: { type: 'status_page', attributes: { aggregate_state } },
    }),
    { status: 200 },
  )
}

describe('useStatusPageApi', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns undefined and makes no fetch when VITE_STATUS_PAGE_URL is unset', () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const queryClient = new QueryClient()

    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    expect(result.current).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('polls <url>/index.json on the configured status page', async () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.protifer.app')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(statusJson('operational'))

    const queryClient = new QueryClient()
    renderHook(() => useStatusPageApi(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://status.protifer.app/index.json',
    )
  })

  it('returns operational when aggregate_state is operational', async () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.protifer.app')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      statusJson('operational'),
    )

    const queryClient = new QueryClient()
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current?.kind).toBe('operational')
  })

  it('returns degraded when aggregate_state is degraded', async () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.protifer.app')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(statusJson('degraded'))

    const queryClient = new QueryClient()
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current?.kind).toBe('degraded')
  })

  it('maps Better Stack "downtime" to our "down" kind', async () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.protifer.app')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(statusJson('downtime'))

    const queryClient = new QueryClient()
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current?.kind).toBe('down')
  })

  it('returns maintenance when aggregate_state is maintenance', async () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.protifer.app')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      statusJson('maintenance'),
    )

    const queryClient = new QueryClient()
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current?.kind).toBe('maintenance')
  })

  it('returns undefined for an unrecognised aggregate_state (falls through to neutral)', async () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.protifer.app')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(statusJson('whatever'))

    const queryClient = new QueryClient()
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    // Give the query a tick to resolve, then assert it stays undefined.
    await waitFor(() => expect(result.current).toBeUndefined())
  })

  it('returns undefined (no crash) when the status API is unreachable', async () => {
    vi.stubEnv('VITE_STATUS_PAGE_URL', 'https://status.protifer.app')
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Network error'),
    )

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { result } = renderHook(() => useStatusPageApi(), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current).toBeUndefined()
    })
  })
})
