import { useMemo } from 'react'

import { NightingaleBase } from './nightingale/NightingaleBase'
import { NightingaleManager } from './nightingale/NightingaleManager'
import { WebComponentErrorBoundary } from './WebComponentErrorBoundary'

import { toVariationData } from '#/services/transform/variation'
import type { VariantMatrix } from '#/types/features'

interface Props {
  sequence: string
  variation: VariantMatrix
}

function VariationViewerInner({ sequence, variation }: Props) {
  const length = sequence.length
  const data = useMemo(
    () => toVariationData(variation, sequence),
    [variation, sequence],
  )

  if (!variation.x_axis.length) {
    return null
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-muted-foreground px-1">
        Mutation Effect Matrix
      </p>
      <div className="overflow-x-auto">
        <NightingaleManager id="lpp-variation-manager">
          <nightingale-navigation
            id="lpp-variation-nav"
            length={length}
            height={40}
          />
          <NightingaleBase
            tag="nightingale-variation"
            data={data}
            id="lpp-variation"
            length={length}
            height={Math.max(100, variation.y_axis.length * 12)}
            class="w-full"
          />
        </NightingaleManager>
      </div>
    </div>
  )
}

export function VariationViewer(props: Props) {
  return (
    <WebComponentErrorBoundary fallback="Variation viewer unavailable.">
      <VariationViewerInner {...props} />
    </WebComponentErrorBoundary>
  )
}
