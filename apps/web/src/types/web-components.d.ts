import type React from 'react'

import type { PdbeMolstarPlugin } from '#/features/structure/hooks/use-pdbe-molstar-plugin'

interface NightingaleBaseAttrs {
  id?: string
  length?: number
  'display-start'?: number
  'display-end'?: number
  height?: number
  width?: number
  'margin-left'?: number
  'margin-right'?: number
  highlight?: string
  'use-ctrl-to-zoom'?: boolean
  class?: string
}

type HideCanvasControl =
  | 'selection'
  | 'animation'
  | 'orientation'
  | 'controlInfo'
  | 'expand'

interface PdbeMolstarAttrs {
  'molecule-id'?: string
  'custom-data-url'?: string
  'custom-data-format'?: string
  'assembly-id'?: string
  'default-preset'?: string
  'alphafold-view'?: string
  encoding?: string
  'low-precision'?: string

  'hide-water'?: string
  'hide-het'?: string
  'hide-non-standard'?: string
  'load-maps'?: string
  'hide-controls'?: string
  'sequence-panel'?: string
  'pdbe-link'?: string
  'loading-overlay'?: string
  expanded?: string
  landscape?: string
  reactive?: string
  'subscribe-events'?: string

  // Canvas controls — JSON-serialised HideCanvasControl[]
  // e.g. '["selection","animation","controlInfo"]'
  'hide-canvas-controls'?: string

  // bg/highlight/select colour channels: 0–255 each
  'bg-color-r'?: string
  'bg-color-g'?: string
  'bg-color-b'?: string

  'highlight-color-r'?: string
  'highlight-color-g'?: string
  'highlight-color-b'?: string

  'select-color-r'?: string
  'select-color-g'?: string
  'select-color-b'?: string

  lighting?: 'flat' | 'matte' | 'glossy' | 'metallic' | 'plastic' | string
  'domain-annotation'?: string
  'validation-annotation'?: string
  'symmetry-annotation'?: string
  'pdbe-url'?: string
}

/** The pdbe-molstar custom element — includes JS property `viewerInstance`. */
interface PdbeMolstarHTMLElement extends HTMLElement, PdbeMolstarAttrs {
  viewerInstance?: PdbeMolstarPlugin
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'nightingale-manager': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >
      'nightingale-navigation': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & NightingaleBaseAttrs,
        HTMLElement
      >
      'nightingale-sequence': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> &
          NightingaleBaseAttrs & { sequence?: string },
        HTMLElement
      >
      'nightingale-colored-sequence': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> &
          NightingaleBaseAttrs & { sequence?: string; scale?: string },
        HTMLElement
      >
      'nightingale-track': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> &
          NightingaleBaseAttrs & {
            'layout-type'?: 'non-overlapping' | 'default'
          },
        HTMLElement
      >
      'nightingale-linegraph-track': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & NightingaleBaseAttrs,
        HTMLElement
      >
      'nightingale-variation': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & NightingaleBaseAttrs,
        HTMLElement
      >
      'nightingale-sequence-heatmap': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> &
          NightingaleBaseAttrs & {
            'heatmap-id'?: string
            'highlight-event'?: 'onmouseover' | 'onclick'
          },
        HTMLElement
      >
      'pdbe-molstar': React.DetailedHTMLProps<
        React.HTMLAttributes<PdbeMolstarHTMLElement> & PdbeMolstarAttrs,
        PdbeMolstarHTMLElement
      >
      'sib-swissbiopics-sl': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          taxid?: string
          sls?: string
        },
        HTMLElement
      >
    }
  }
}
