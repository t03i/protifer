import { Link, createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/cite')({
  component: CitePage,
})

interface Citation {
  title: string
  authors: string
  journal: string
  year: number
  doi: string
  description: string
}

const citations: Citation[] = [
  {
    title:
      'ProtTrans: Toward Understanding the Language of Life Through Self-Supervised Learning',
    authors: 'Elnaggar A, Heinzinger M, Dallago C, et al.',
    journal: 'IEEE Transactions on Pattern Analysis and Machine Intelligence',
    year: 2022,
    doi: '10.1109/TPAMI.2021.3095381',
    description:
      'The ProtTrans T5 model (prot_t5_xl_u50) underlying all embeddings used in protifer.',
  },
  {
    title:
      'Light attention predicts protein location from the language of life',
    authors: 'Stärk H, Dallago C, Heinzinger M, Rost B.',
    journal: 'Bioinformatics Advances',
    year: 2021,
    doi: '10.1093/bioadv/vbab035',
    description: 'Subcellular localization and membrane-bound prediction.',
  },
  {
    title:
      'Learned embeddings from deep learning to visualize and predict protein sets',
    authors: 'Heinzinger M, Elnaggar A, Wang Y, et al.',
    journal: 'Current Protocols',
    year: 2022,
    doi: '10.1002/cpz1.471',
    description: 'Secondary structure, disorder, and binding site predictions.',
  },
  {
    title: 'VESPA: Variant Effect Score Prediction using Protein Embeddings',
    authors: 'Marquet C, Heinzinger M, Olenyi T, et al.',
    journal: 'Journal of Molecular Biology',
    year: 2022,
    doi: '10.1016/j.jmb.2021.167222',
    description:
      'VESPAi variant effect prediction (20×N substitution effect matrix).',
  },
  {
    title:
      'Prediction of protein–protein interaction sites using patch-based residue characterization',
    authors: 'Littmann M, Heinzinger M, Dallago C, Weissenow K, Rost B.',
    journal: 'Bioinformatics',
    year: 2021,
    doi: '10.1093/bioinformatics/btab638',
    description:
      'Binding site prediction for metal, nucleic acid, and small molecule.',
  },
  {
    title: 'Gene Ontology: the framework for the model of biology',
    authors: 'Ashburner M, Ball CA, Blake JA, et al.',
    journal: 'Nature Genetics',
    year: 2000,
    doi: '10.1038/75556',
    description: 'Gene Ontology framework used for GO term predictions.',
  },
]

function CitePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">How to Cite</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          protifer is the successor to the Rostlab{"'"}s earlier protein
          prediction services —{' '}
          <a
            href="https://predictprotein.org"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            PredictProtein
            <ExternalLink className="h-3 w-3" />
          </a>
          ,{' '}
          <a
            href="https://lambda.predictprotein.org"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            LambdaPP
            <ExternalLink className="h-3 w-3" />
          </a>
          , and{' '}
          <a
            href="https://docs.bioembeddings.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            bio-embeddings
            <ExternalLink className="h-3 w-3" />
          </a>{' '}
          — and consolidates their prediction heads onto a single pLM-based
          pipeline. If you use protifer in your research, please cite the
          publications below. Each citation corresponds to a specific prediction
          method.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Primary citation</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          When citing protifer as a whole, please use the ProtTrans publication
          as the primary reference and mention the protifer web server at{' '}
          <a
            href="https://lambda.predictprotein.org"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            lambda.predictprotein.org
            <ExternalLink className="h-3 w-3" />
          </a>
          . See the{' '}
          <Link to="/about" className="text-primary hover:underline">
            About
          </Link>{' '}
          page for the LambdaPP method paper used as the interim combined
          reference until a protifer-specific publication is available.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Method citations</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Cite the individual method references for the predictions you rely on.
          The{' '}
          <Link to="/methods" className="text-primary hover:underline">
            Methods
          </Link>{' '}
          page maps each prediction on this site to its upstream publication.
        </p>
        <ul className="space-y-4">
          {citations.map((c) => (
            <li key={c.doi} className="rounded-lg border bg-card p-4 space-y-1">
              <p className="text-sm font-semibold leading-snug">{c.title}</p>
              <p className="text-xs text-muted-foreground">{c.authors}</p>
              <p className="text-xs text-muted-foreground">
                {c.journal} ({c.year})
              </p>
              <a
                href={`https://doi.org/${c.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                doi:{c.doi}
                <ExternalLink className="h-3 w-3" />
              </a>
              <p className="text-xs italic text-muted-foreground pt-1">
                {c.description}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}
