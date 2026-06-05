// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// NOTE: we test the contract, not the implementation details of DOM injection.
// Full integration is verified manually in the browser.

describe('useLazyPdbeMolstarAssets', () => {
  // Reset module-level state between tests.
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns false initially when script is not loaded', async () => {
    // Mock IntersectionObserver to never fire
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() })),
    )

    const { useLazyPdbeMolstarAssets } =
      await import('./use-lazy-pdbe-molstar-assets')
    const ref = { current: document.createElement('div') }
    const { result } = renderHook(() => useLazyPdbeMolstarAssets(ref))

    expect(result.current).toBe(false)
  })

  it('returns true after IntersectionObserver fires and script loads', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((cb: IntersectionObserverCallback) => ({
        observe: vi.fn(() => {
          cb(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          )
        }),
        disconnect: vi.fn(),
      })),
    )

    // Fire the script tag's onload synchronously.
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag)
      if (tag === 'script') {
        Object.defineProperty(el, 'onload', {
          set(fn: () => void) {
            fn()
          },
        })
      }
      return el
    })

    const { useLazyPdbeMolstarAssets } =
      await import('./use-lazy-pdbe-molstar-assets')
    const ref = { current: document.createElement('div') }
    const { result } = renderHook(() => useLazyPdbeMolstarAssets(ref))

    await vi.waitFor(() => {
      expect(result.current).toBe(true)
    })
  })
})
