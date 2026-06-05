export interface FaqLink {
  label: string
  to?: string
  href?: string
}

export interface FaqItem {
  id: string
  question: string
  answer: string
  seeAlso?: readonly FaqLink[]
}

export const faqItems: readonly FaqItem[] = [
  {
    id: 'plm-vs-homology',
    question: 'How is this different from BLAST or homology-based prediction?',
    answer:
      'Traditional methods infer features by finding evolutionarily related sequences and transferring annotations across them. protifer runs your sequence through a protein language model (ProtT5) that already encodes structural and functional regularities learned from hundreds of millions of proteins — so a prediction comes back in seconds for any sequence, including ones without close homologs.',
    seeAlso: [{ label: 'Methods', to: '/methods' }],
  },
  {
    id: 'vs-alphafold',
    question: 'Where does protifer fit next to AlphaFold?',
    answer:
      'AlphaFold gives you a 3D structure. protifer gives you the per-residue and per-protein annotations that structure alone does not answer — secondary structure states, transmembrane topology, disorder, binding residues, variant effects, conservation, subcellular localization, and GO terms. When a structure exists in the AlphaFold Database we show it alongside the predictions; otherwise we fall back to ColabFold.',
    seeAlso: [
      { label: 'AlphaFold DB', href: 'https://alphafold.ebi.ac.uk/' },
      { label: 'Methods', to: '/methods' },
    ],
  },
  {
    id: 'inputs',
    question: 'What inputs are accepted?',
    answer:
      'A UniProt accession, a UniProt protein name, a FASTA record, or a raw amino-acid sequence using IUPAC single-letter codes. Extended codes (B, Z, J, U, O) are accepted but mapped to X. Click any of the example chips on the landing page to prefill a valid input in each format.',
    seeAlso: [{ label: 'Glossary', to: '/glossary' }],
  },
  {
    id: 'size-limits',
    question: 'How large a protein can I submit?',
    answer:
      'The embedding model handles sequences up to roughly 6 000 residues in a single pass. Very long proteins may be chunked automatically or rejected with a message — try splitting into domains if you hit the limit. Batch submissions are available to research users via the API.',
  },
  {
    id: 'data-handling',
    question: 'What happens to the sequences I submit?',
    answer:
      'Predictions and embeddings are stored hash-keyed so identical inputs are deduplicated and served from cache. We do not share submitted sequences with third parties. See the privacy page for the full disclosure including error-tracing (Sentry) behaviour.',
    seeAlso: [{ label: 'Privacy', to: '/legal' }],
  },
  {
    id: 'cite',
    question: 'How do I cite protifer?',
    answer:
      'Cite the primary method paper for each prediction you use. The citation page lists the canonical reference for every model protifer exposes, and each card on the methods page links directly to the DOI.',
    seeAlso: [
      { label: 'Cite', to: '/cite' },
      { label: 'Methods', to: '/methods' },
    ],
  },
  {
    id: 'quotas',
    question: 'Are there rate limits or quotas?',
    answer:
      'Public usage is rate-limited per IP; authenticated users get higher submission and polling limits, and research plans unlock batch submission. If you hit a limit you will see a clear error — no silent throttling.',
  },
  {
    id: 'issues',
    question: 'I found a bug or have a feature request.',
    answer:
      'Please open an issue on the public GitHub repository. protifer is developed in the open; pull requests and method-integration proposals are welcome.',
    seeAlso: [{ label: 'GitHub', href: 'https://github.com/t03i/protifer' }],
  },
  {
    id: 'contribute',
    question: 'Can I add my own prediction method?',
    answer:
      'If you have a published pLM-based predictor and want it integrated, reach out via the repository issues. Each method lives behind a small TypeScript card (summary, inputs, outputs, DOI) and a worker that turns embeddings into predictions — the integration surface is intentionally thin.',
  },
] as const
