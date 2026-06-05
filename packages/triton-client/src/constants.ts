/** 20-AA ordering of the VespaG ONNX model output axis. */
export const AMINO_ACIDS = [
  'A',
  'L',
  'G',
  'V',
  'S',
  'R',
  'E',
  'D',
  'T',
  'I',
  'P',
  'K',
  'F',
  'Q',
  'N',
  'Y',
  'M',
  'H',
  'W',
  'C',
] as const

/** DSSP3 label order: argmax index → secondary-structure character. */
export const DSSP3_LABELS = ['H', 'E', 'C'] as const

/** DSSP8 label order: argmax index → secondary-structure character. */
export const DSSP8_LABELS = ['H', 'G', 'I', 'B', 'E', 'S', 'T', 'C'] as const
