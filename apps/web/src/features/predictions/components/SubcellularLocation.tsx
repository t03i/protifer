import { useEffect } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import type { SubcellularLocation } from '#/features/predictions/constants'

const SL_ID_MAP: Partial<Record<string, string>> = {
  // keys from SUBCELLULAR_LOCATIONS in constants.ts; values are numeric SwissBiopics IDs
  'Cell Membrane': '39',
  Cytoplasm: '86',
  'Endoplasmic Reticulum': '95',
  'Golgi Apparatus': '138',
  Mitochondrion: '173',
  Nucleus: '191',
  Peroxisome: '204',
  Vacuole: '265',
  Plastid: '205',
  Extracellular: '102',
}

// The web component requires this template to exist in the DOM.
// We hide the sidebar list items so only the cell diagram is shown.
const SL_TEMPLATE = `<template id="sibSwissBioPicsSlLiItem">
  <li class="subcellular_location" style="display:none">
    <a class="subcell_name"></a>
    <span class="subcell_description"></span>
  </li>
</template>`

interface Props {
  location: string
  membraneBound: string
}

export function SubcellularLocation({ location, membraneBound }: Props) {
  const slId = SL_ID_MAP[location]

  useEffect(() => {
    if (!document.getElementById('sibSwissBioPicsSlLiItem')) {
      const container = document.createElement('div')
      container.innerHTML = SL_TEMPLATE
      document.body.appendChild(container)
    }
    if (
      typeof customElements !== 'undefined' &&
      !customElements.get('sib-swissbiopics-sl')
    ) {
      // @ts-expect-error -- no type definitions
      import('@swissprot/swissbiopics-visualizer')
    }
  }, [])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Subcellular Location
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium">{location}</p>
        <p className="text-xs text-muted-foreground">
          Membrane bound: {membraneBound}
        </p>
        {slId ? (
          <sib-swissbiopics-sl taxid="2759" sls={slId} />
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No diagram available for &ldquo;{location}&rdquo;
          </p>
        )}
      </CardContent>
    </Card>
  )
}
