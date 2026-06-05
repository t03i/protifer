import { describe, expect, it } from 'vitest'

import { validateRawSearch } from './raw.schema'

describe('validateRawSearch', () => {
  it('accepts a well-formed UniProt accession', () => {
    const result = validateRawSearch({
      sequence: 'MKTAYI',
      accession: 'P04637',
    })
    expect(result.accession).toBe('P04637')
    expect(result.sequence).toBe('MKTAYI')
  })

  it('strips a malformed accession without erroring', () => {
    const result = validateRawSearch({
      sequence: 'MKTAYI',
      accession: 'not-an-accession',
    })
    expect(result.accession).toBeUndefined()
    expect(result.sequence).toBe('MKTAYI')
  })

  it('leaves accession undefined when absent (today’s behavior)', () => {
    const result = validateRawSearch({ sequence: 'MKTAYI' })
    expect(result.accession).toBeUndefined()
    expect(result.sequence).toBe('MKTAYI')
  })

  it('passes through the optional model search param', () => {
    const result = validateRawSearch({
      sequence: 'MKTAYI',
      accession: 'P04637',
      model: 'AF-P04637-F1',
    })
    expect(result.model).toBe('AF-P04637-F1')
  })

  it('strips non-string accession values', () => {
    const result = validateRawSearch({ sequence: 'MKTAYI', accession: 42 })
    expect(result.accession).toBeUndefined()
  })
})
