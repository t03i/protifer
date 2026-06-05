import bindingSvg from '#/assets/marketing/predictions/binding.svg?raw'
import conservationSvg from '#/assets/marketing/predictions/conservation.svg?raw'
import disorderSvg from '#/assets/marketing/predictions/disorder.svg?raw'
import geneOntologySvg from '#/assets/marketing/predictions/gene-ontology.svg?raw'
import secondaryStructureSvg from '#/assets/marketing/predictions/secondary-structure.svg?raw'
import subcellularSvg from '#/assets/marketing/predictions/subcellular.svg?raw'
import transmembraneSvg from '#/assets/marketing/predictions/transmembrane.svg?raw'
import variantEffectSvg from '#/assets/marketing/predictions/variant-effect.svg?raw'

export interface PredictionShowcase {
  id: string
  title: string
  shortTitle: string
  description: string
  tags: readonly string[]
  thumbnailSvg: string
  methodSlug: string
}

export const predictions: readonly PredictionShowcase[] = [
  {
    id: 'secondary-structure',
    title: 'Secondary Structure',
    shortTitle: 'DSSP',
    description:
      'Per-residue secondary structure in 3 states (helix, sheet, coil) and 8 states, predicted from pLM embeddings — no homologous sequences required.',
    tags: ['Residue-level', 'DSSP3', 'DSSP8'],
    thumbnailSvg: secondaryStructureSvg,
    methodSlug: 'prott5sec',
  },
  {
    id: 'transmembrane',
    title: 'Transmembrane Topology',
    shortTitle: 'TM Topology',
    description:
      'Identifies membrane-spanning segments and the topology of integral membrane proteins — essential for drug-target annotation and membrane-protein architecture.',
    tags: ['Residue-level', 'Topology'],
    thumbnailSvg: transmembraneSvg,
    methodSlug: 'tmbed',
  },
  {
    id: 'disorder',
    title: 'Intrinsic Disorder',
    shortTitle: 'Disorder',
    description:
      'Flags flexible regions that lack a stable 3D structure. Disordered regions are often functionally critical for signalling, regulation and protein–protein interaction.',
    tags: ['Residue-level', 'Flexibility'],
    thumbnailSvg: disorderSvg,
    methodSlug: 'seth',
  },
  {
    id: 'binding',
    title: 'Binding Sites',
    shortTitle: 'Binding',
    description:
      'Predicts residues involved in metal-ion coordination, nucleic-acid interaction, and small-molecule binding — enabling functional annotation without experimental data.',
    tags: ['Residue-level', 'Metal', 'Nucleic Acid', 'Small Molecule'],
    thumbnailSvg: bindingSvg,
    methodSlug: 'bindembed21dl',
  },
  {
    id: 'conservation',
    title: 'Conservation',
    shortTitle: 'Conservation',
    description:
      'Evolutionary conservation per residue, inferred from pLM embeddings as a proxy for sequence variation. Highly conserved positions often mark functionally critical sites.',
    tags: ['Residue-level', 'Evolution'],
    thumbnailSvg: conservationSvg,
    methodSlug: 'prott5cons',
  },
  {
    id: 'variant-effect',
    title: 'Variant Effect (VESPAi)',
    shortTitle: 'VESPAi',
    description:
      'Scores every possible single amino-acid substitution at every position, producing a 20 × N pathogenicity matrix for deep-mutational-scanning-style analysis.',
    tags: ['Residue-level', 'Variants', 'VESPAi'],
    thumbnailSvg: variantEffectSvg,
    methodSlug: 'vespai',
  },
  {
    id: 'subcellular',
    title: 'Subcellular Localization',
    shortTitle: 'Localization',
    description:
      'Classifies the protein into one of ten subcellular compartments and predicts membrane association — visualised on an interactive SwissBioPics cell diagram.',
    tags: ['Protein-level', 'Localization'],
    thumbnailSvg: subcellularSvg,
    methodSlug: 'light-attention',
  },
  {
    id: 'gene-ontology',
    title: 'Gene Ontology',
    shortTitle: 'GO Terms',
    description:
      'Gene Ontology terms across biological process, molecular function and cellular component ontologies. Each term carries a reliability index.',
    tags: ['Protein-level', 'Functional Annotation'],
    thumbnailSvg: geneOntologySvg,
    methodSlug: 'gopredsim',
  },
] as const
