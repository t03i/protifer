import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface PdbeMolstarPlugin {
  events: {
    loadComplete: {
      subscribe: (cb: (loaded: boolean) => void) => { unsubscribe: () => void }
    }
  }
  visual: {
    highlight: (params: {
      data: Array<{ beg_label_seq_id?: number; end_label_seq_id?: number }>
    }) => Promise<void>
    clearHighlight: () => Promise<void>
    select: (params: {
      data: Array<{ beg_label_seq_id?: number; end_label_seq_id?: number }>
    }) => Promise<void>
    clearSelection: () => Promise<void>
  }
}

export interface PdbeMolstarElement extends HTMLElement {
  viewerInstance?: PdbeMolstarPlugin
}

// Elements whose loadComplete Subject has already fired.
// Checked before subscribing to handle the ultra-rare "already loaded" case.
const loadedElements = new WeakSet<HTMLElement>()

export function usePdbeMolstarPlugin(
  elementRef: RefObject<PdbeMolstarElement | null>,
  assetsLoaded: boolean,
): boolean {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (!assetsLoaded) return

    const el = elementRef.current
    if (!el) return

    let cancelled = false

    void customElements.whenDefined('pdbe-molstar').then(() => {
      if (cancelled) return

      const plugin = el.viewerInstance
      if (!plugin) return

      // Defend against loadComplete firing before we subscribed (only possible
      // if render() finishes in the same JS task as connectedCallback).
      if (loadedElements.has(el)) {
        setIsReady(true)
        return
      }

      const sub = plugin.events.loadComplete.subscribe((loaded) => {
        if (loaded && !cancelled) {
          loadedElements.add(el)
          setIsReady(true)
          sub.unsubscribe()
        }
      })

      return () => sub.unsubscribe()
    })

    return () => {
      cancelled = true
    }
  }, [assetsLoaded, elementRef])

  return isReady
}
