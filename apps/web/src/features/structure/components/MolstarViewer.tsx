import { useEffect, useRef } from 'react'

import { Skeleton } from '#/components/ui/skeleton'
import { useSelection } from '#/features/structure/context/selection'
import { useVisualizationRefs } from '#/features/structure/context/visualization-refs'
import { useLazyPdbeMolstarAssets } from '#/features/structure/hooks/use-lazy-pdbe-molstar-assets'
import { usePdbeMolstarPlugin } from '#/features/structure/hooks/use-pdbe-molstar-plugin'
import type { BeaconsStructure } from '#/types/structure'

interface Props {
  structure: BeaconsStructure
  resolvedTheme: 'light' | 'dark'
  onReady?: (ready: boolean) => void
}

// next-themes applies the dark class to <html> in a useEffect (after render),
// so getComputedStyle during render would read stale light values. Use the
// CSS-derived constants directly — they match styles.css exactly.
// Light --card: oklch(1 0 0) = rgb(255,255,255)
// Dark  --card: oklch(0.141 0.005 285.823) = rgb(9,9,11)
function getBgColor(resolvedTheme: 'light' | 'dark'): {
  r: string
  g: string
  b: string
} {
  if (resolvedTheme === 'dark') {
    return { r: '9', g: '9', b: '11' }
  }
  return { r: '255', g: '255', b: '255' }
}

type PendingHighlight = { start: number; end: number } | null

export function MolstarViewer({ structure, resolvedTheme, onReady }: Props) {
  const bg = getBgColor(resolvedTheme)
  const containerRef = useRef<HTMLDivElement>(null)
  const pendingHighlight = useRef<PendingHighlight>(null)

  const { molstarRef } = useVisualizationRefs()
  const { start, end } = useSelection()

  const assetsLoaded = useLazyPdbeMolstarAssets(containerRef)
  const isReady = usePdbeMolstarPlugin(molstarRef, assetsLoaded)

  useEffect(() => {
    onReady?.(isReady)
  }, [isReady, onReady])

  // Flush pending highlight the moment the plugin becomes ready.
  useEffect(() => {
    if (!isReady) return
    const el = molstarRef.current
    const plugin = el?.viewerInstance
    if (!plugin) return

    const pending = pendingHighlight.current
    if (pending !== null) {
      void plugin.visual.select({
        data: [
          { beg_label_seq_id: pending.start, end_label_seq_id: pending.end },
        ],
      })
    }
  }, [isReady, molstarRef])

  // Sync selection → Molstar. Queue if not ready yet.
  useEffect(() => {
    const plugin = molstarRef.current?.viewerInstance

    if (!isReady || !plugin) {
      pendingHighlight.current =
        start !== null && end !== null ? { start, end } : null
      return
    }

    if (start !== null && end !== null) {
      void plugin.visual.select({
        data: [{ beg_label_seq_id: start, end_label_seq_id: end }],
      })
    } else {
      void plugin.visual.clearHighlight()
      void plugin.visual.clearSelection()
    }
  }, [isReady, molstarRef, start, end])

  return (
    <div ref={containerRef} className="relative h-96 w-full rounded-md border">
      {!isReady && <Skeleton className="absolute inset-0 rounded-md" />}
      {assetsLoaded && structure.model_url && (
        <pdbe-molstar
          ref={molstarRef}
          custom-data-url={structure.model_url}
          custom-data-format={
            structure.model_format?.toLowerCase() ??
            (/\.cif$/i.test(structure.model_url) ? 'mmcif' : 'pdb')
          }
          bg-color-r={bg.r}
          bg-color-g={bg.g}
          bg-color-b={bg.b}
          hide-controls="true"
          hide-canvas-controls='["selection","animation","orientation","controlInfo"]'
          sequence-panel="false"
          className="block h-full w-full"
        />
      )}
    </div>
  )
}
