import type { LineData } from '@nightingale-elements/nightingale-linegraph-track'

import { findIndexes, findRanges } from './features'

import type { NightingaleFeature } from '#/features/interactive/components/nightingale/nightingale.types'
import { proteinColorSchemes } from '#/services/coloring'
import type { PredictionResponse } from '#/types/features'

function stringToFeatures(
  str: string,
  activeLetters: string[],
  colorMap: Record<string, string>,
  tooltipMap: Record<string, string>,
): NightingaleFeature[] {
  const indexMap = findIndexes(str, activeLetters)
  const features: NightingaleFeature[] = []

  for (const [letter, positions] of Object.entries(indexMap)) {
    for (const { x, y } of findRanges(positions)) {
      features.push({
        accession: letter,
        start: x,
        end: y,
        color: colorMap[letter] ?? '#cccccc',
        tooltipContent: tooltipMap[letter] ?? letter,
      })
    }
  }

  return features
}

const DSSP3_TOOLTIPS: Record<string, string> = {
  H: 'Helix',
  E: 'Sheet',
  C: 'Other',
}

const DSSP8_TOOLTIPS: Record<string, string> = {
  H: 'Alpha helix',
  G: '3-10 helix',
  I: 'Pi helix',
  B: 'Beta bridge',
  E: 'Beta strand',
  S: 'Bend',
  T: 'Turn',
  C: 'Coil',
}

const TRANSMEMBRANE_TOOLTIPS: Record<string, string> = {
  H: 'Helix – outwards',
  h: 'Helix – inwards',
  B: 'Sheet – outwards',
  b: 'Sheet – inwards',
  S: 'Signal peptide',
  i: 'Non-membrane – inside',
  o: 'Non-membrane – outside',
}

const BINDING_TOOLTIPS: Record<string, string> = {
  b: 'Binding residue',
}

function safeNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value : []
}

export function toNightingaleData(predictions: PredictionResponse) {
  const { dssp8, transmembrane, metal, nucleicAcids, smallMolecules } =
    proteinColorSchemes

  // Binding alphabet collapses to `b`/`-`; each track keeps its own palette
  // colour but keyed under `b` instead of `M`/`N`/`S`.
  const metalBindingColorMap: Record<string, string> = {
    b: metal.contrast['M'],
  }
  const nucleicAcidsBindingColorMap: Record<string, string> = {
    b: nucleicAcids.contrast['N'],
  }
  const smallMoleculesBindingColorMap: Record<string, string> = {
    b: smallMolecules.contrast['S'],
  }

  return {
    dssp3: stringToFeatures(
      predictions.predictedDSSP3,
      ['H', 'E', 'C'],
      dssp8.contrast,
      DSSP3_TOOLTIPS,
    ),
    dssp8: stringToFeatures(
      predictions.predictedDSSP8,
      ['H', 'G', 'I', 'B', 'E', 'S', 'T', 'C'],
      dssp8.contrast,
      DSSP8_TOOLTIPS,
    ),
    transmembrane: stringToFeatures(
      predictions.predictedTransmembrane,
      ['H', 'h', 'B', 'b', 'S', 'i', 'o'],
      transmembrane.contrast,
      TRANSMEMBRANE_TOOLTIPS,
    ),
    disorder: [
      {
        name: 'Disorder',
        color: '#0F8292',
        range: [0, 1] as [number, number],
        values: safeNumberArray(predictions.predictedDisorder).map(
          (value, i) => ({
            position: i + 1,
            value,
          }),
        ),
      },
    ] satisfies LineData[],
    bindingMetal: stringToFeatures(
      predictions.predictedBindingMetal,
      ['b'],
      metalBindingColorMap,
      BINDING_TOOLTIPS,
    ).map((f) => ({ ...f, shape: 'circle' as const })),
    bindingNucleicAcids: stringToFeatures(
      predictions.predictedBindingNucleicAcids,
      ['b'],
      nucleicAcidsBindingColorMap,
      BINDING_TOOLTIPS,
    ).map((f) => ({ ...f, shape: 'circle' as const })),
    bindingSmallMolecules: stringToFeatures(
      predictions.predictedBindingSmallMolecules,
      ['b'],
      smallMoleculesBindingColorMap,
      BINDING_TOOLTIPS,
    ).map((f) => ({ ...f, shape: 'circle' as const })),
    conservation: [
      {
        name: 'Conservation',
        range: [0, 9] as [number, number],
        values: safeNumberArray(predictions.predictedConservation).map(
          (value, i) => ({
            position: i + 1,
            value,
          }),
        ),
      },
    ] satisfies LineData[],
    macroEffect: [
      {
        name: 'μ Variation',
        color: '#00babd',
        range: [0, 200] as [number, number],
        values: safeNumberArray(predictions.predictedMacroEffectScore).map(
          (value, i) => ({
            position: i + 1,
            value,
          }),
        ),
      },
    ] satisfies LineData[],
  }
}

export type NightingaleData = ReturnType<typeof toNightingaleData>
