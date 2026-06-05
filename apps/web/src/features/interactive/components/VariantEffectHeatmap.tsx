import React, { useEffect, useMemo, useRef } from 'react'

import { NightingaleManager } from './nightingale/NightingaleManager'
import { WebComponentErrorBoundary } from './WebComponentErrorBoundary'

import { toHeatmapData } from '#/services/transform/variation'
import type { VariantMatrix } from '#/types/features'

interface Props {
  sequence: string
  variation: VariantMatrix
}

interface NightingaleSequenceHeatmapElement extends HTMLElement {
  setHeatmapData: (
    xDomain: number[],
    yDomain: string[],
    data: { xValue: number; yValue: string; score: number }[],
  ) => void
}

function VariantEffectHeatmapInner({ sequence, variation }: Props) {
  const ref = useRef<NightingaleSequenceHeatmapElement>(null)
  const length = sequence.length
  const { xDomain, yDomain, data } = useMemo(
    () => toHeatmapData(variation),
    [variation],
  )

  useEffect(() => {
    const el = ref.current
    if (!el || data.length === 0) return
    el.setHeatmapData(xDomain, yDomain, data)
  }, [xDomain, yDomain, data])

  if (!variation.x_axis.length) return null

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-muted-foreground px-1">
        Variant Effect Heatmap
      </p>
      <div className="overflow-x-auto pl-5">
        <NightingaleManager id="lpp-heatmap-manager">
          <nightingale-navigation
            id="lpp-heatmap-nav"
            length={length}
            height={40}
            margin-left={0}
            margin-right={0}
          />
          <nightingale-sequence
            id="lpp-heatmap-seq"
            length={length}
            height={20}
            sequence={sequence}
            margin-left={0}
            margin-right={0}
          />
          <nightingale-sequence-heatmap
            ref={ref as React.RefObject<HTMLElement>}
            id="lpp-heatmap"
            heatmap-id="variant-effect-heatmap"
            length={length}
            height={Math.max(100, variation.y_axis.length * 15)}
            highlight-event="onmouseover"
            margin-left={0}
            margin-right={0}
          />
        </NightingaleManager>
      </div>
    </div>
  )
}

export function VariantEffectHeatmap(props: Props) {
  return (
    <WebComponentErrorBoundary fallback="Variant effect heatmap unavailable.">
      <VariantEffectHeatmapInner {...props} />
    </WebComponentErrorBoundary>
  )
}
