export const InputType = {
  fasta: 'fasta',
  residue: 'residue',
  uniprot_id: 'uniprot_id',
  uniprot_protein_name: 'uniprot_protein_name',
  invalid: 'invalid',
} as const

export type InputType = (typeof InputType)[keyof typeof InputType]

export const InputAlphabet = {
  iupac: 'iupac',
  iupac_extended: 'iupac_extended',
  undefined: 'undefined',
} as const

export type InputAlphabet = (typeof InputAlphabet)[keyof typeof InputAlphabet]

export interface SequenceResult {
  sequence: string
  accession: string | undefined
}

export interface InputValidation {
  type: InputType
  alphabet: InputAlphabet
  isValid: boolean
}

export const MIN_INPUT_LEN = 3
export const MAX_INPUT_LEN = 2000
