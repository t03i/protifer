export interface Method {
  slug: string
  name: string
  summary: string
  inputs: string
  outputs: string
  doi: string
  citation: string
}

export const methods: readonly Method[] = [
  {
    slug: 'prott5',
    name: 'ProtT5',
    summary:
      'A protein language model (T5-XL) trained self-supervised on UniRef50. Produces per-residue and per-protein embeddings that encode structural and functional information without homology search.',
    inputs: 'Amino-acid sequence (up to ~6 000 residues).',
    outputs:
      'Per-residue embedding matrix (L × 1024) and mean-pooled per-protein vector.',
    doi: '10.1109/TPAMI.2021.3095381',
    citation: 'Elnaggar A, Heinzinger M, Dallago C, et al. IEEE TPAMI (2022).',
  },
  {
    slug: 'prott5sec',
    name: 'ProtT5Sec (secondary structure)',
    summary:
      'Convolutional classifier over ProtT5 embeddings predicting DSSP3 (H / E / C) and DSSP8 secondary-structure states per residue — no MSA required.',
    inputs: 'ProtT5 per-residue embeddings.',
    outputs: 'Per-residue DSSP3 and DSSP8 class probabilities.',
    doi: '10.1002/cpz1.113',
    citation:
      'Dallago C, Schütze K, Heinzinger M, et al. Current Protocols (2021).',
  },
  {
    slug: 'prott5cons',
    name: 'ProtT5Cons (conservation)',
    summary:
      'Predicts an evolutionary-conservation score (0–8) per residue directly from pLM embeddings, approximating conservation without running a multiple-sequence alignment.',
    inputs: 'ProtT5 per-residue embeddings.',
    outputs: 'Integer conservation score per residue on a 0–8 scale.',
    doi: '10.1093/nargab/lqad014',
    citation:
      'Marquet C, Grekova A, Heinzinger M, et al. NAR Genomics & Bioinformatics (2023).',
  },
  {
    slug: 'tmbed',
    name: 'TMbed (transmembrane)',
    summary:
      'Detects α-helical and β-barrel transmembrane segments and signal peptides, together with their topology (inside / outside) — sequence-only.',
    inputs: 'ProtT5 per-residue embeddings.',
    outputs:
      'Per-residue class (inside, TM-helix, TM-strand, signal peptide, outside).',
    doi: '10.1186/s12859-022-04873-x',
    citation: 'Bernhofer M, Rost B. BMC Bioinformatics (2022).',
  },
  {
    slug: 'seth',
    name: 'SETH (disorder)',
    summary:
      'Predicts per-residue intrinsic disorder scores that correlate with the CheZOD NMR reference measure — fast and accurate pLM-based disorder.',
    inputs: 'ProtT5 per-residue embeddings.',
    outputs:
      'Continuous disorder score per residue (higher = more disordered).',
    doi: '10.3389/fbinf.2022.1019597',
    citation:
      'Ilzhöfer D, Heinzinger M, Rost B. Frontiers in Bioinformatics (2022).',
  },
  {
    slug: 'bindembed21dl',
    name: 'bindEmbed21DL (binding sites)',
    summary:
      'Predicts residues that contact metal ions, nucleic acids, or small-molecule ligands from sequence embeddings alone.',
    inputs: 'ProtT5 per-residue embeddings.',
    outputs:
      'Per-residue binding class probabilities (metal, nucleic acid, small molecule).',
    doi: '10.1038/s41598-022-11877-3',
    citation:
      'Littmann M, Heinzinger M, Dallago C, et al. Scientific Reports (2022).',
  },
  {
    slug: 'vespai',
    name: 'VESPAi (variant effect)',
    summary:
      'Scores the functional effect of every possible single amino-acid substitution at every position, producing a 20×N deep-mutational-scanning-style matrix.',
    inputs: 'Amino-acid sequence + ProtT5 embeddings.',
    outputs:
      '20 × L variant-effect matrix with per-substitution scores in [0, 1].',
    doi: '10.1016/j.jmb.2021.167222',
    citation: 'Marquet C, Heinzinger M, Olenyi T, et al. J. Mol. Biol. (2022).',
  },
  {
    slug: 'light-attention',
    name: 'Light Attention (subcellular localization)',
    summary:
      'A light-attention network over ProtT5 embeddings that classifies proteins into ten subcellular compartments and predicts membrane association.',
    inputs: 'ProtT5 per-residue embeddings.',
    outputs:
      'Probability distribution over 10 compartments + binary membrane flag.',
    doi: '10.1093/bioadv/vbab035',
    citation:
      'Stärk H, Dallago C, Heinzinger M, Rost B. Bioinformatics Advances (2021).',
  },
  {
    slug: 'gopredsim',
    name: 'GoPredSim (Gene Ontology)',
    summary:
      'Assigns Gene Ontology terms by nearest-neighbour lookup in embedding space, returning per-term reliability indices across BPO, MFO and CCO.',
    inputs: 'ProtT5 per-protein embedding.',
    outputs: 'Ranked GO terms with reliability index per ontology branch.',
    doi: '10.1093/bioinformatics/btaa1107',
    citation:
      'Littmann M, Heinzinger M, Dallago C, Olenyi T, Rost B. Bioinformatics (2021).',
  },
  {
    slug: 'structure-source',
    name: 'AlphaFold DB / ColabFold (3D structure)',
    summary:
      'Structures are served from the AlphaFold Protein Structure Database when available; otherwise computed on demand via a ColabFold-style pipeline.',
    inputs: 'UniProt accession or amino-acid sequence.',
    outputs: 'Predicted PDB model with pLDDT confidence rendered in-browser.',
    doi: '10.1038/s41586-021-03819-2',
    citation: 'Jumper J, Evans R, Pritzel A, et al. Nature (2021).',
  },
] as const

export function methodBySlug(slug: string): Method | undefined {
  return methods.find((m) => m.slug === slug)
}
