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

const P53_SEQUENCE =
  'MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGPDEAPRMPEAAPPVAPAPAAPTPAAPAPAPSWPLSSSVPSQKTYQGSYGFRLGFLHSGTAKSVTCTYSPALNKMFCQLAKTCPVQLWVDSTPPPGTRVRAMAIYKQSQHMTEVVRRCPHHERCSDSDGLAPPQHLIRVEGNLRVEYLDDRNTFRHSVVVPYEPPEVGSDCTTIHYNYMCNSSCMGGMNRRPILTIITLEDSSGNLLGRNSFEVRVCACPGRDRRTEEENLRKKGEPHHELPPGSTKRALPNNTSSSPQPKKKPLDGEYFTLQIRGRERFEMFRELNEALELKDAQAGKEPGGSRAHSSHLKSKKGQSTSRHKKLMFKTEGPDSD'

export const exampleSequences: readonly ExampleSequence[] = [
  {
    format: 'fasta',
    label: 'FASTA',
    value: `>sp|P04637|P53_HUMAN Cellular tumor antigen p53
${P53_SEQUENCE}`,
    description: 'FASTA record for human cellular tumor antigen p53 (P04637).',
  },
  {
    format: 'uniprot_id',
    label: 'UniProt accession',
    value: 'P04637',
    description: 'UniProt accession for human cellular tumor antigen p53.',
  },
  {
    format: 'uniprot_protein_name',
    label: 'Protein name',
    value: 'P53_HUMAN',
    description: 'UniProt protein name for the same entry.',
  },
  {
    format: 'sequence',
    label: 'Amino acids',
    value: P53_SEQUENCE,
    description: 'Plain amino-acid sequence (IUPAC single-letter codes).',
  },
] as const
