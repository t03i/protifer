// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServiceKind } from './types'
import type { ConnectionHealth } from './useConnectionHealth'

vi.mock('./useConnectionHealth', () => ({ useConnectionHealth: vi.fn() }))
vi.mock('./useStatusPageApi', () => ({ useStatusPageApi: vi.fn() }))

const { useConnectionHealth } = await import('./useConnectionHealth')
const { useStatusPageApi } = await import('./useStatusPageApi')
const { useServiceStatus } = await import('./useServiceStatus')

function setup(opts: {
  health?: ConnectionHealth
  remote?: { kind: ServiceKind; detail?: string }
}) {
  vi.mocked(useConnectionHealth).mockReturnValue(opts.health ?? 'ok')
  vi.mocked(useStatusPageApi).mockReturnValue(opts.remote)
}

afterEach(() => vi.restoreAllMocks())

describe('useServiceStatus', () => {
  it('does NOT report operational when the status page is unavailable', () => {
    setup({ health: 'ok', remote: undefined })
    const { result } = renderHook(() => useServiceStatus())
    expect(result.current.kind).not.toBe('operational')
    expect(result.current.kind).toBe('unknown')
  })

  it('reports operational only when the status page says so', () => {
    setup({ remote: { kind: 'operational' } })
    const { result } = renderHook(() => useServiceStatus())
    expect(result.current.kind).toBe('operational')
  })

  it('passes through degraded/maintenance/down from the status page', () => {
    setup({ remote: { kind: 'degraded', detail: 'Slow embeddings' } })
    const { result } = renderHook(() => useServiceStatus())
    expect(result.current).toEqual({
      kind: 'degraded',
      detail: 'Slow embeddings',
    })
  })

  it('prioritizes in-session connection-lost over the status page', () => {
    setup({ health: 'lost', remote: { kind: 'operational' } })
    const { result } = renderHook(() => useServiceStatus())
    expect(result.current.kind).toBe('connection-lost')
  })
})
