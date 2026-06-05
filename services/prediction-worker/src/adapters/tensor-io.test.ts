import { describe, it, expect } from 'vitest'

import { argmaxSlice } from './tensor-io.ts'

describe('argmaxSlice', () => {
  it('returns the index of the max within the slice (offset 0)', () => {
    expect(argmaxSlice([0.1, 0.9, 0.3], 0, 3)).toBe(1)
  })

  it('returns 0 when the first element is the max', () => {
    expect(argmaxSlice([0.9, 0.1, 0.3], 0, 3)).toBe(0)
  })

  it('returns the last index when it dominates', () => {
    expect(argmaxSlice([0.1, 0.2, 0.8], 0, 3)).toBe(2)
  })

  it('respects offset for per-residue slices', () => {
    const flat = [0.1, 0.9, 0.0, 0.7, 0.2, 0.1]
    expect(argmaxSlice(flat, 0, 3)).toBe(1)
    expect(argmaxSlice(flat, 3, 3)).toBe(0)
  })

  it('treats missing entries as -Infinity', () => {
    expect(argmaxSlice([0.5], 0, 3)).toBe(0)
  })

  it('returns the first index on ties (strict greater-than)', () => {
    expect(argmaxSlice([0.5, 0.5, 0.5], 0, 3)).toBe(0)
  })

  it('works with Float32Array', () => {
    expect(argmaxSlice(new Float32Array([0.2, 0.1, 0.9, 0.4]), 0, 4)).toBe(2)
  })
})
