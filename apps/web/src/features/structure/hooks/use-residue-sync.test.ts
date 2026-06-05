// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useResidueSync } from './use-residue-sync'

import {
  SelectionProvider,
  useSelection,
} from '#/features/structure/context/selection'

function fireMolstarClick(el: HTMLElement, eventData: Record<string, unknown>) {
  const event = new MouseEvent('PDB.molstar.click', { bubbles: true })
  Object.assign(event, { eventData })
  el.dispatchEvent(event)
}

let managerEl: HTMLElement

beforeEach(() => {
  managerEl = document.createElement('div')
  document.body.appendChild(managerEl)
})

afterEach(() => {
  managerEl.remove()
})

function useResidueSyncWithCapture(
  molstarRefArg: { current: HTMLElement | null },
  isReady: boolean,
) {
  useResidueSync(molstarRefArg as Parameters<typeof useResidueSync>[0], isReady)
  return useSelection()
}

describe('useResidueSync', () => {
  it('Mol* click with valid seq_id selects { start: seq_id, end: seq_id }', async () => {
    const molstarEl = document.createElement('div')
    const molstarRef = { current: molstarEl }

    const { result } = renderHook(
      () => useResidueSyncWithCapture(molstarRef, true),
      { wrapper: SelectionProvider },
    )

    act(() => {
      fireMolstarClick(molstarEl, { seq_id: 42 })
    })

    expect(result.current.start).toBe(42)
    expect(result.current.end).toBe(42)
  })

  it('Mol* click with seq_id_begin/seq_id_end selects { start, end }', async () => {
    const molstarEl = document.createElement('div')
    const molstarRef = { current: molstarEl }

    const { result } = renderHook(
      () => useResidueSyncWithCapture(molstarRef, true),
      { wrapper: SelectionProvider },
    )

    act(() => {
      fireMolstarClick(molstarEl, { seq_id_begin: 10, seq_id_end: 20 })
    })

    expect(result.current.start).toBe(10)
    expect(result.current.end).toBe(20)
  })

  it('Mol* click with undefined eventData does NOT select (no throw)', async () => {
    const molstarEl = document.createElement('div')
    const molstarRef = { current: molstarEl }

    const { result } = renderHook(
      () => useResidueSyncWithCapture(molstarRef, true),
      { wrapper: SelectionProvider },
    )

    act(() => {
      const event = new MouseEvent('PDB.molstar.click', { bubbles: true })
      molstarEl.dispatchEvent(event)
    })

    expect(result.current.start).toBeNull()
    expect(result.current.end).toBeNull()
  })

  it('Mol* click with falsy seq_id (0, undefined) does NOT select', async () => {
    const molstarEl = document.createElement('div')
    const molstarRef = { current: molstarEl }

    const { result } = renderHook(
      () => useResidueSyncWithCapture(molstarRef, true),
      { wrapper: SelectionProvider },
    )

    act(() => {
      fireMolstarClick(molstarEl, { seq_id: 0 })
    })

    expect(result.current.start).toBeNull()
    expect(result.current.end).toBeNull()
  })

  it('No event listener added when isReady=false', async () => {
    const molstarEl = document.createElement('div')
    const molstarRef = { current: molstarEl }

    const { result } = renderHook(
      () => useResidueSyncWithCapture(molstarRef, false),
      { wrapper: SelectionProvider },
    )

    act(() => {
      fireMolstarClick(molstarEl, { seq_id: 42 })
    })

    expect(result.current.start).toBeNull()
    expect(result.current.end).toBeNull()
  })

  it('Event listener removed on unmount (cleanup)', async () => {
    const molstarEl = document.createElement('div')
    const molstarRef = { current: molstarEl }

    const { result, unmount } = renderHook(
      () => useResidueSyncWithCapture(molstarRef, true),
      { wrapper: SelectionProvider },
    )

    unmount()

    act(() => {
      fireMolstarClick(molstarEl, { seq_id: 42 })
    })

    expect(result.current.start).toBeNull()
    expect(result.current.end).toBeNull()
  })
})
