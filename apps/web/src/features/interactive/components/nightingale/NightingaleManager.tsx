import NightingaleColoredSequenceElement from '@nightingale-elements/nightingale-colored-sequence'
import NightingaleLinegraphTrackElement from '@nightingale-elements/nightingale-linegraph-track'
import NightingaleManagerElement from '@nightingale-elements/nightingale-manager'
import NightingaleNavigationElement from '@nightingale-elements/nightingale-navigation'
import NightingaleSequenceElement from '@nightingale-elements/nightingale-sequence'
import NightingaleSequenceHeatmapElement from '@nightingale-elements/nightingale-sequence-heatmap'
import NightingaleTrackElement from '@nightingale-elements/nightingale-track'
import NightingaleVariationElement from '@nightingale-elements/nightingale-variation'
import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { useSelection } from '#/features/structure/context/selection'
import { useVisualizationRefs } from '#/features/structure/context/visualization-refs'

// Register custom elements in the DOM registry once. Each package declares
// `sideEffects: false`, so the production build tree-shakes a bare
// `import '...'` and the @customElementOnce decorator that registers the
// element never runs — leaving un-upgraded elements (e.g.
// `setHeatmapData is not a function`). Import the element classes and reference
// them below so the modules are retained and their decorators self-register.

const NIGHTINGALE_ELEMENTS: ReadonlyArray<[string, CustomElementConstructor]> =
  [
    ['nightingale-manager', NightingaleManagerElement],
    ['nightingale-navigation', NightingaleNavigationElement],
    ['nightingale-sequence', NightingaleSequenceElement],
    ['nightingale-colored-sequence', NightingaleColoredSequenceElement],
    ['nightingale-track', NightingaleTrackElement],
    ['nightingale-linegraph-track', NightingaleLinegraphTrackElement],
    ['nightingale-variation', NightingaleVariationElement],
    ['nightingale-sequence-heatmap', NightingaleSequenceHeatmapElement],
  ]

// The imports above self-register via a decorator on evaluation; this guarded
// loop both anchors that reference (so the bundler can't drop the modules) and
// acts as a fallback registrar.
for (const [tagName, ElementClass] of NIGHTINGALE_ELEMENTS) {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, ElementClass)
  }
}

interface Props {
  id: string
  children: ReactNode
}

// Nightingale fires `change` CustomEvents with `eventType` (not `type`).
// Residue range lives in `detail.feature.start/end` after the manager unwraps
// nested feature references (see nightingale-new-core bindEvents.ts).
interface NightingaleChangeDetail {
  eventType: 'click' | 'mouseover' | 'mouseout' | 'reset'
  feature?: {
    start?: number
    end?: number
    position?: number
  } | null
}

export function NightingaleManager({ id, children }: Props) {
  const { nightingaleRef } = useVisualizationRefs()
  const { selectResidues, clearSelection, start, end } = useSelection()

  useEffect(() => {
    const el = nightingaleRef.current
    if (!el) return

    const handler = (e: Event) => {
      // detail can be null for internal coordinate-sync events (Nightingale itself guards against this)
      const detail = (e as CustomEvent<NightingaleChangeDetail | null>).detail
      if (!detail) return

      if (detail.eventType === 'click') {
        const f = detail.feature
        if (!f) return
        // FeatureData has start/end; SequenceBaseData has position
        const s = f.start ?? f.position
        const e2 = f.end ?? f.position
        if (s !== undefined && e2 !== undefined) {
          selectResidues(s, e2)
        }
      } else if (detail.eventType === 'reset') {
        clearSelection()
      }
    }

    el.addEventListener('change', handler)
    return () => el.removeEventListener('change', handler)
  }, [selectResidues, clearSelection, nightingaleRef])

  // Context -> Nightingale: sync highlight attribute when selection changes
  useEffect(() => {
    const el = nightingaleRef.current
    if (!el) return
    if (start !== null && end !== null) {
      el.setAttribute('highlight', `${start}:${end}`)
    } else {
      el.removeAttribute('highlight')
    }
  }, [start, end, nightingaleRef])

  return (
    <nightingale-manager ref={nightingaleRef} id={id}>
      {children}
    </nightingale-manager>
  )
}
