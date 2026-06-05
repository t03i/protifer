import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/glossary')({
  component: GlossaryPage,
})

interface GlossaryEntry {
  term: string
  group:
    | 'Foundations'
    | 'Per-residue predictions'
    | 'Per-protein predictions'
    | 'Input & identifiers'
  definition: string
  doi?: string
}

const entries: readonly GlossaryEntry[] = [
  {
    term: 'pLM (Protein Language Model)',
    group: 'Foundations',
    definition:
      'A neural network trained on large protein sequence databases using self-supervised objectives borrowed from natural language processing. pLMs learn to encode structural and functional information in fixed-length embedding vectors without any labelled data. protifer uses ProtT5 (prot_t5_xl_u50).',
    doi: '10.1109/TPAMI.2021.3095381',
  },
  {
    term: 'Embedding',
    group: 'Foundations',
    definition:
      'A dense numerical vector representation of a protein sequence or individual residue, produced by a pLM. Embeddings capture evolutionary, structural, and functional properties implicitly learned during training.',
    doi: '10.1002/cpz1.113',
  },
  {
    term: 'DSSP3 / DSSP8',
    group: 'Per-residue predictions',
    definition:
      'Secondary structure assignments using the DSSP algorithm. DSSP3 classifies each residue as Helix (H), Sheet (E), or Coil (C). DSSP8 uses eight states: H (α-helix), G (3₁₀-helix), I (π-helix), B (β-bridge), E (β-strand), S (bend), T (turn), C (coil).',
  },
  {
    term: 'Transmembrane (TM) topology',
    group: 'Per-residue predictions',
    definition:
      'Description of which regions of a membrane protein span the lipid bilayer (transmembrane helices or beta-barrels), which face the cytoplasm, and which face the extracellular space. protifer uses TMbed.',
    doi: '10.1186/s12859-022-04873-x',
  },
  {
    term: 'Intrinsic disorder',
    group: 'Per-residue predictions',
    definition:
      'Protein regions that lack a stable, well-defined 3D structure under physiological conditions. Intrinsically disordered regions (IDRs) are common in eukaryotes and are often involved in signalling, transcription regulation, and protein–protein interactions. protifer uses SETH.',
    doi: '10.3389/fbinf.2022.1019597',
  },
  {
    term: 'bindEmbed21DL',
    group: 'Per-residue predictions',
    definition:
      'Predicts residues that contact metal ions, nucleic acids, or small-molecule ligands from sequence embeddings alone.',
    doi: '10.1038/s41598-022-11877-3',
  },
  {
    term: 'VESPAi',
    group: 'Per-residue predictions',
    definition:
      'Variant Effect Score Prediction using Protein Embeddings — a method that scores the likely pathogenic effect of every possible single amino-acid substitution at every position in a sequence, producing a 20 × N matrix.',
    doi: '10.1016/j.jmb.2021.167222',
  },
  {
    term: 'GO term (Gene Ontology)',
    group: 'Per-protein predictions',
    definition:
      'Standardised vocabulary for describing gene product attributes across species. Terms are organised in three ontologies: Biological Process (BPO), Molecular Function (MFO), and Cellular Component (CCO).',
    doi: '10.1038/75556',
  },
  {
    term: 'RI (Reliability Index)',
    group: 'Per-protein predictions',
    definition:
      'A score between 0 and 1 indicating the confidence of a GO term prediction. Higher values indicate greater confidence. Thresholds: MFO ≥ 0.28, CCO ≥ 0.29, BPO ≥ 0.35.',
    doi: '10.1093/bioinformatics/btaa1107',
  },
  {
    term: 'Light attention',
    group: 'Per-protein predictions',
    definition:
      'Light-attention network over ProtT5 embeddings that classifies proteins into ten subcellular compartments and predicts membrane association.',
    doi: '10.1093/bioadv/vbab035',
  },
  {
    term: 'ColabFold / AlphaFold DB',
    group: 'Per-protein predictions',
    definition:
      '3D structures are served from the AlphaFold Protein Structure Database when available; otherwise computed on demand via a ColabFold-style pipeline.',
    doi: '10.1038/s41586-021-03819-2',
  },
  {
    term: 'UniProt accession',
    group: 'Input & identifiers',
    definition:
      'A stable, unique identifier assigned to each protein entry in the UniProtKB database, e.g. P04637 (human TP53). Accessions are case-sensitive and follow the pattern [A-Z][0-9][A-Z]{3}[0-9] or [OPQ][0-9][A-Z0-9]{3}[0-9].',
  },
  {
    term: 'FASTA format',
    group: 'Input & identifiers',
    definition:
      'A plain-text format for representing sequence data. A FASTA record begins with a ">" header line followed by one or more lines of sequence. protifer extracts the sequence and ignores the header.',
  },
  {
    term: 'IUPAC alphabet',
    group: 'Input & identifiers',
    definition:
      'The International Union of Pure and Applied Chemistry defines standard single-letter codes for amino acids: ACDEFGHIKLMNPQRSTVWY (20 standard) plus X (unknown). protifer also accepts extended codes B, Z, J, U, O with a warning.',
  },
]

const GROUP_ORDER: readonly GlossaryEntry['group'][] = [
  'Foundations',
  'Per-residue predictions',
  'Per-protein predictions',
  'Input & identifiers',
]

function slugify(group: string): string {
  return group
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function GlossaryPage() {
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: entries.filter((e) => e.group === group),
  }))

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Glossary</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Definitions for key terms used throughout protifer and its
          documentation. Entries are grouped by topic; published methods link to
          their primary publication.
        </p>
        <nav
          aria-label="Glossary sections"
          className="flex flex-wrap gap-2 pt-1"
        >
          {grouped.map(({ group }) => (
            <a
              key={group}
              href={`#${slugify(group)}`}
              className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              {group}
            </a>
          ))}
        </nav>
      </header>

      {grouped.map(({ group, items }) => (
        <section
          key={group}
          id={slugify(group)}
          aria-labelledby={`${slugify(group)}-heading`}
          className="scroll-mt-20 space-y-4"
        >
          <h2
            id={`${slugify(group)}-heading`}
            className="text-xl font-semibold"
          >
            {group}
          </h2>
          <dl className="space-y-3">
            {items.map(({ term, definition, doi }) => (
              <div
                key={term}
                className="rounded-lg border bg-card p-4 space-y-2"
              >
                <dt className="text-sm font-semibold">{term}</dt>
                <dd className="text-sm text-muted-foreground leading-relaxed">
                  {definition}
                </dd>
                {doi && (
                  <a
                    href={`https://doi.org/${doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    doi:{doi}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </dl>
        </section>
      ))}
    </article>
  )
}
