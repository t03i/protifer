import { RE_UNIPROT_FASTA } from './validation'

import type { SequenceResult } from '#/types/sequence'

export function parseResidue(input: string): string {
  return input.trim().split(/\s+/).join('')
}

export function parseFasta(input: string): SequenceResult {
  const lines = input.trim().split('\n')
  const header = lines[0]!
  const sequence = lines.slice(1).join('')

  const match = RE_UNIPROT_FASTA.exec(header)
  const accession = match?.groups?.id

  return { sequence, accession }
}
