import { useMemo } from 'react'

import { NightingaleLabeledTrack } from './nightingale/NightingaleLabeledTrack'
import { NightingaleManager } from './nightingale/NightingaleManager'
import { WebComponentErrorBoundary } from './WebComponentErrorBoundary'

import { toNightingaleData } from '#/services/transform/nightingale'
import type { PredictionResponse } from '#/types/features'

interface Props {
  sequence: string
  predictions: PredictionResponse
}

function NightingaleViewerInner({ sequence, predictions }: Props) {
  const length = sequence.length
  const data = useMemo(() => toNightingaleData(predictions), [predictions])

  return (
    <div className="overflow-x-auto space-y-1">
      <NightingaleManager id="lpp-manager">
        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0" />
          <nightingale-navigation
            id="lpp-nav"
            length={length}
            height={40}
            margin-left={0}
            margin-right={0}
            class="flex-1"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0 text-right text-xs text-muted-foreground">
            Sequence
          </span>
          <nightingale-sequence
            id="lpp-seq"
            length={length}
            height={20}
            sequence={sequence}
            margin-left={0}
            margin-right={0}
            class="flex-1"
          />
        </div>

        <NightingaleLabeledTrack
          tag="nightingale-track"
          id="lpp-tm"
          length={length}
          data={data.transmembrane}
          label="Topology"
          layoutType="default"
        />
        <NightingaleLabeledTrack
          tag="nightingale-track"
          id="lpp-dssp3"
          length={length}
          data={data.dssp3}
          label="Structure"
          layoutType="default"
        />
        <NightingaleLabeledTrack
          tag="nightingale-linegraph-track"
          id="lpp-disorder"
          length={length}
          data={data.disorder}
          label="Disorder"
          height={40}
        />
        <NightingaleLabeledTrack
          tag="nightingale-track"
          id="lpp-binding-metal"
          length={length}
          data={data.bindingMetal}
          label="Metal binding"
          layoutType="default"
        />
        <NightingaleLabeledTrack
          tag="nightingale-track"
          id="lpp-binding-nucleic"
          length={length}
          data={data.bindingNucleicAcids}
          label="Nucleic binding"
          layoutType="default"
        />
        <NightingaleLabeledTrack
          tag="nightingale-track"
          id="lpp-binding-small"
          length={length}
          data={data.bindingSmallMolecules}
          label="Small mol. binding"
          layoutType="default"
        />
        <NightingaleLabeledTrack
          tag="nightingale-linegraph-track"
          id="lpp-macro-effect"
          length={length}
          data={data.macroEffect}
          label="μ Variation"
          height={40}
        />
        <NightingaleLabeledTrack
          tag="nightingale-track"
          id="lpp-dssp8"
          length={length}
          data={data.dssp8}
          label="DSSP8"
          layoutType="default"
        />
        <NightingaleLabeledTrack
          tag="nightingale-linegraph-track"
          id="lpp-conservation"
          length={length}
          data={data.conservation}
          label="Conservation"
          height={40}
        />
      </NightingaleManager>
    </div>
  )
}

export function NightingaleViewer(props: Props) {
  return (
    <WebComponentErrorBoundary fallback="Sequence viewer unavailable.">
      <NightingaleViewerInner {...props} />
    </WebComponentErrorBoundary>
  )
}
