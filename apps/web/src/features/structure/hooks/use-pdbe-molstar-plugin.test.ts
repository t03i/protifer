// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { usePdbeMolstarPlugin } from './use-pdbe-molstar-plugin'

function makeMockPlugin() {
  const listeners: Array<(loaded: boolean) => void> = []
  return {
    events: {
      loadComplete: {
        subscribe: vi.fn((cb: (loaded: boolean) => void) => {
          listeners.push(cb)
          return { unsubscribe: vi.fn() }
        }),
      },
    },
    visual: {
      highlight: vi.fn().mockResolvedValue(undefined),
      clearHighlight: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(undefined),
      clearSelection: vi.fn().mockResolvedValue(undefined),
    },
    _fire: (v: boolean) => listeners.forEach((cb) => cb(v)),
  }
}

describe('usePdbeMolstarPlugin', () => {
  it('returns false when assetsLoaded is false', () => {
    const ref = { current: null }
    const { result } = renderHook(() => usePdbeMolstarPlugin(ref, false))
    expect(result.current).toBe(false)
  })

  it('returns false before loadComplete fires', async () => {
    const plugin = makeMockPlugin()
    const el = Object.assign(document.createElement('div'), {
      viewerInstance: plugin,
    })
    const ref = { current: el }

    vi.spyOn(customElements, 'whenDefined').mockResolvedValue(
      undefined as unknown as CustomElementConstructor,
    )

    const { result } = renderHook(() => usePdbeMolstarPlugin(ref, true))

    await vi.waitFor(() => {
      expect(plugin.events.loadComplete.subscribe).toHaveBeenCalled()
    })

    expect(result.current).toBe(false)
  })

  it('returns true after loadComplete fires with true', async () => {
    const plugin = makeMockPlugin()
    const el = Object.assign(document.createElement('div'), {
      viewerInstance: plugin,
    })
    const ref = { current: el }

    vi.spyOn(customElements, 'whenDefined').mockResolvedValue(
      undefined as unknown as CustomElementConstructor,
    )

    const { result } = renderHook(() => usePdbeMolstarPlugin(ref, true))

    await vi.waitFor(() =>
      expect(plugin.events.loadComplete.subscribe).toHaveBeenCalled(),
    )

    act(() => plugin._fire(true))

    expect(result.current).toBe(true)
  })

  it('stays false if loadComplete fires with false (load error)', async () => {
    const plugin = makeMockPlugin()
    const el = Object.assign(document.createElement('div'), {
      viewerInstance: plugin,
    })
    const ref = { current: el }

    vi.spyOn(customElements, 'whenDefined').mockResolvedValue(
      undefined as unknown as CustomElementConstructor,
    )

    const { result } = renderHook(() => usePdbeMolstarPlugin(ref, true))

    await vi.waitFor(() =>
      expect(plugin.events.loadComplete.subscribe).toHaveBeenCalled(),
    )

    act(() => plugin._fire(false))

    expect(result.current).toBe(false)
  })
})
