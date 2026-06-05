export type ExampleFormat =
  | 'fasta'
  | 'uniprot_id'
  | 'uniprot_protein_name'
  | 'sequence'

export interface ExampleSequence {
  format: ExampleFormat
  label: string
  value: string
  description: string
}

const GAP_JUNCTION_SEQUENCE =
  'MCCPCCCRARGRVSVWELGIVAGVLGVAVYDAAYVLGVRFVHDHSLQVIRELERRFPSGSIYHLRQQTITYSYILEHPSYLMSYMNPLPIYMLFLSMYVLAIFTKLRENDQFIKLCGVFCKKHSPSNMMADILWYCEDEALCTCWAAIRQMWVEVFPHTQWAATLILPHAMLPHVNAILLGMCFL'

export const exampleSequences: readonly ExampleSequence[] = [
  {
    format: 'fasta',
    label: 'FASTA',
    value: `>tr|A0A654IBU3|A0A654IBU3_HUMAN Gap junction protein
${GAP_JUNCTION_SEQUENCE}`,
    description: 'FASTA record for human gap junction protein A0A654IBU3.',
  },
  {
    format: 'uniprot_id',
    label: 'UniProt accession',
    value: 'A0A654IBU3',
    description: 'UniProt accession for human gap junction protein.',
  },
  {
    format: 'uniprot_protein_name',
    label: 'Protein name',
    value: 'A0A654IBU3_HUMAN',
    description: 'UniProt protein name for the same entry.',
  },
  {
    format: 'sequence',
    label: 'Amino acids',
    value: GAP_JUNCTION_SEQUENCE,
    description: 'Plain amino-acid sequence (IUPAC single-letter codes).',
  },
] as const
