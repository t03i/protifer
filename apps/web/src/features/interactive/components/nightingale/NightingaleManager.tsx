import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { useSelection } from '#/features/structure/context/selection'
import { useVisualizationRefs } from '#/features/structure/context/visualization-refs'

// Side-effect imports — register custom elements in the DOM registry once
import '@nightingale-elements/nightingale-manager'
import '@nightingale-elements/nightingale-navigation'
import '@nightingale-elements/nightingale-sequence'
import '@nightingale-elements/nightingale-colored-sequence'
import '@nightingale-elements/nightingale-track'
import '@nightingale-elements/nightingale-linegraph-track'
import '@nightingale-elements/nightingale-variation'
import '@nightingale-elements/nightingale-sequence-heatmap'

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
