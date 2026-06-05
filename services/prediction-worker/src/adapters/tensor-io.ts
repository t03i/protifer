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
