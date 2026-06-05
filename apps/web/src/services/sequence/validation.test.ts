import { describe, expect, it } from 'vitest'

import { evalInputType } from './validation'

import { InputAlphabet, InputType } from '#/types/sequence'

describe('evalInputType', () => {
  it('recognizes UniProt accession P12345', () => {
    const [type, alphabet] = evalInputType('P12345')
    expect(type).toBe(InputType.uniprot_id)
    expect(alphabet).toBe(InputAlphabet.undefined)
  })

  it('recognizes UniProt accession A0A654IBU3', () => {
    const [type] = evalInputType('A0A654IBU3')
    expect(type).toBe(InputType.uniprot_id)
  })

  it('recognizes UniProt protein name HEMOA_HUMAN', () => {
    const [type] = evalInputType('HEMOA_HUMAN')
    expect(type).toBe(InputType.uniprot_protein_name)
  })

  it('recognizes plain amino acid sequence', () => {
    const [type, alphabet] = evalInputType('MKTAYIAKQR')
    expect(type).toBe(InputType.residue)
    expect(alphabet).toBe(InputAlphabet.iupac)
  })

  it('recognizes extended IUPAC with B/Z/J/U/O', () => {
    const [type, alphabet] = evalInputType('MKTBZJUO')
    expect(type).toBe(InputType.residue)
    expect(alphabet).toBe(InputAlphabet.iupac_extended)
  })

  it('recognizes FASTA format', () => {
    const [type] = evalInputType('>sp|P12345|TEST\nMKTAYIAKQR')
    expect(type).toBe(InputType.fasta)
  })

  it('rejects input shorter than 3 characters', () => {
    const [type] = evalInputType('MK')
    expect(type).toBe(InputType.invalid)
  })

  it('rejects completely invalid input', () => {
    const [type] = evalInputType('12345678901')
    expect(type).toBe(InputType.invalid)
  })
})
