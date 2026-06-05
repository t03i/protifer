import { describe, expect, it } from 'vitest'

import { parseFasta, parseResidue } from './parser'

describe('parseResidue', () => {
  it('strips whitespace and newlines', () => {
    expect(parseResidue('MKT\n AYI\n AKQ R')).toBe('MKTAYIAKQR')
  })
})

describe('parseFasta', () => {
  it('extracts sequence and accession from UniProt FASTA', () => {
    const input = '>sp|P12345|TEST_HUMAN some protein\nMKTAYI\nAKQR'
    const result = parseFasta(input)
    expect(result.sequence).toBe('MKTAYIAKQR')
    expect(result.accession).toBe('P12345')
  })

  it('extracts sequence without accession from generic FASTA', () => {
    const input = '>some header\nMKTAYIAKQR'
    const result = parseFasta(input)
    expect(result.sequence).toBe('MKTAYIAKQR')
    expect(result.accession).toBeUndefined()
  })
})
