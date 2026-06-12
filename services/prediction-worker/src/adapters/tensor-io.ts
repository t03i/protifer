import type { InferResponse } from '@protifer/triton-client'

import { DecodeError } from './errors.ts'

/**
 * Resolve the index of a named output in a Triton response. Triton does not
 * guarantee outputs come back in requested/config order (notably ensembles —
 * tmbed returned them reversed), so adapters must decode by name, never by a
 * hardcoded position. `raw_output_contents` is parallel to `response.outputs`,
 * so the returned index is valid for both the raw buffers and the contents
 * fallback. Throws DecodeError if the named output is absent.
 */
export function outputIndexByName(
  response: InferResponse,
  name: string,
): number {
  const idx = response.outputs.findIndex((o) => o.name === name)
  if (idx === -1) {
    throw new DecodeError(
      `${response.model_name}: response missing '${name}' output`,
    )
  }
  return idx
}

/**
 * Index of the maximum value in the `nClasses`-wide slice of `flat` starting at
 * `offset` (i.e. argmax over `flat[offset .. offset + nClasses)`). Missing
 * entries are treated as `-Infinity`. Shared by the classification adapters.
 */
export function argmaxSlice(
  flat: ArrayLike<number>,
  offset: number,
  nClasses: number,
): number {
  let maxIdx = 0
  let maxVal = flat[offset] ?? -Infinity
  for (let c = 1; c < nClasses; c++) {
    const v = flat[offset + c] ?? -Infinity
    if (v > maxVal) {
      maxVal = v
      maxIdx = c
    }
  }
  return maxIdx
}
