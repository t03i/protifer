// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isMachineUserKey, useApiKeys } from '../hooks/use-api-keys'
import type { ApiKeySummary } from '../hooks/use-api-keys'

vi.mock('#/services/auth/client', () => ({
  authClient: {
    apiKey: {
      list: vi.fn(),
    },
  },
}))

const { authClient } = await import('#/services/auth/client')
const apiKey = (
  authClient as unknown as {
    apiKey: { list: ReturnType<typeof vi.fn> }
  }
).apiKey

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const humanKey: ApiKeySummary = {
  id: 'human-1',
  name: 'my laptop',
  start: 'protifer_h1',
  prefix: null,
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
  lastRequest: null,
  enabled: true,
  ownerEmail: 'alice@example.com',
}

const machineKey: ApiKeySummary = {
  id: 'machine-1',
  name: 'ci-loadtest-pro',
  start: 'protifer_m1',
  prefix: null,
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
  lastRequest: null,
  enabled: true,
  ownerEmail: 'ci-loadtest-pro@protifer.invalid',
}

describe('useApiKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters out @protifer.invalid-owned keys', async () => {
    apiKey.list.mockResolvedValue({
      data: { apiKeys: [humanKey, machineKey], total: 2 },
      error: null,
    })

    const { result } = renderHook(() => useApiKeys(), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0]?.id).toBe('human-1')
  })

  it('keeps keys when owner email is absent (backend does not expose it)', async () => {
    const keyWithoutOwner: ApiKeySummary = {
      ...humanKey,
      ownerEmail: undefined,
    }
    apiKey.list.mockResolvedValue({
      data: { apiKeys: [keyWithoutOwner], total: 1 },
      error: null,
    })

    const { result } = renderHook(() => useApiKeys(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
  })
})

describe('isMachineUserKey', () => {
  it('detects @protifer.invalid suffix regardless of local-part', () => {
    expect(
      isMachineUserKey({ ...machineKey, ownerEmail: 'x@protifer.invalid' }),
    ).toBe(true)
    expect(
      isMachineUserKey({
        ...machineKey,
        ownerEmail: 'ci-loadtest-free@protifer.invalid',
      }),
    ).toBe(true)
  })

  it('does not match real emails or similar-looking suffixes', () => {
    expect(
      isMachineUserKey({
        ...humanKey,
        ownerEmail: 'alice@protifer.invalid.com',
      }),
    ).toBe(false)
    expect(
      isMachineUserKey({ ...humanKey, ownerEmail: 'alice@example.com' }),
    ).toBe(false)
    expect(isMachineUserKey({ ...humanKey, ownerEmail: null })).toBe(false)
    expect(isMachineUserKey({ ...humanKey, ownerEmail: undefined })).toBe(false)
  })
})
