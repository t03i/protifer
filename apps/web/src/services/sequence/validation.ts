import {
  InputAlphabet,
  InputType,
  MAX_INPUT_LEN,
  MIN_INPUT_LEN,
} from '#/types/sequence'

const IUPAC = 'ACDEFGHIKLMNPQRSTVWYX'
const IUPAC_EXTENDED = IUPAC + 'BZJUO'

const RE_ACCESSION =
  /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2}$/
const RE_UNIPROT_NAME = /^[A-Z0-9]{3,20}_[A-Z0-9]{3,20}$/
const RE_INVALID_AA = new RegExp(`^$|[^${IUPAC}]`)
const RE_INVALID_AA_EXTENDED = new RegExp(`^$|[^${IUPAC_EXTENDED}]`)
const RE_UNIPROT_FASTA = new RegExp(
  `^>(?:tr|sp)\\|(?<id>${RE_ACCESSION.source.slice(1, -1)})\\|.*$`,
)
const RE_FASTA_HEADER = /^>.*$/

export { RE_ACCESSION, RE_UNIPROT_FASTA }

function getSequenceDetails(input: string): [InputType, InputAlphabet] {
  if (!RE_INVALID_AA.test(input)) {
    return [InputType.residue, InputAlphabet.iupac]
  }
  if (!RE_INVALID_AA_EXTENDED.test(input)) {
    return [InputType.residue, InputAlphabet.iupac_extended]
  }
  return [InputType.invalid, InputAlphabet.undefined]
}

export function evalInputType(input: string): [InputType, InputAlphabet] {
  const testStr = input.toUpperCase()

  if (input.length <= MIN_INPUT_LEN || input.length > MAX_INPUT_LEN) {
    return [InputType.invalid, InputAlphabet.undefined]
  }

  if (RE_UNIPROT_NAME.test(testStr)) {
    return [InputType.uniprot_protein_name, InputAlphabet.undefined]
  }

  if (RE_ACCESSION.test(testStr)) {
    return [InputType.uniprot_id, InputAlphabet.undefined]
  }

  const [type, alphabet] = getSequenceDetails(testStr)
  if (type !== InputType.invalid) {
    return [type, alphabet]
  }

  const lines = testStr.split(/\r?\n/)
  if (lines.length > 1 && RE_FASTA_HEADER.test(lines[0]!)) {
    const [, fastaAlphabet] = getSequenceDetails(lines.slice(1).join(''))
    if (fastaAlphabet !== InputAlphabet.undefined) {
      return [InputType.fasta, fastaAlphabet]
    }
  }

  return [InputType.invalid, InputAlphabet.undefined]
}
