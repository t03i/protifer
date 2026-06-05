import { describe, expect, it } from 'vitest'

import { findIndexes, findRanges } from './features'

describe('findIndexes', () => {
  it('maps characters to 1-based positions', () => {
    const result = findIndexes('HHECH', ['H', 'E', 'C'])
    expect(result.H).toEqual([1, 2, 5])
    expect(result.E).toEqual([3])
    expect(result.C).toEqual([4])
  })

  it('returns empty arrays for missing characters', () => {
    const result = findIndexes('HHH', ['E'])
    expect(result.E).toEqual([])
  })
})

describe('findRanges', () => {
  it('merges consecutive positions into ranges', () => {
    expect(findRanges([1, 2, 3, 5, 6, 10])).toEqual([
      { x: 1, y: 3 },
      { x: 5, y: 6 },
      { x: 10, y: 10 },
    ])
  })

  it('returns empty for empty input', () => {
    expect(findRanges([])).toEqual([])
  })
})
