import { Link, createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">About</h1>
        <p className="text-muted-foreground">
          protifer is a sequence-only protein feature prediction platform built
          on protein language models. It succeeds{' '}
          <a
            href="https://lambda.predictprotein.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            LambdaPP
          </a>{' '}
          and is developed in the open at the Rostlab.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Who we are</h2>
        <p className="text-sm text-muted-foreground">
          Rostlab — the Department of Bioinformatics &amp; Computational Biology
          at the Technical University of Munich (TUM), led by Prof. Dr. Burkhard
          Rost. The lab pioneered protein-language-model-based prediction and
          has released open tools for the community for over two decades.
        </p>
        <address className="not-italic text-sm text-muted-foreground">
          Rostlab, Chair of Bioinformatics &amp; Computational Biology (I12)
          <br />
          School of Computation, Information and Technology
          <br />
          Technical University of Munich
          <br />
          Boltzmannstraße 3, 85748 Garching, Germany
        </address>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Open source</h2>
        <p className="text-sm text-muted-foreground">
          protifer's frontend, API gateway, and prediction workers are open
          source. Issues and pull requests are welcome.
        </p>
        <p>
          <a
            href="https://github.com/t03i/protifer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            github.com/t03i/protifer
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Citation</h2>
        <p className="text-sm text-muted-foreground">
          Until a protifer-specific publication is available, please cite the
          LambdaPP method paper alongside the primary reference of each
          prediction you rely on:
        </p>
        <div className="rounded-lg border bg-card p-4 text-sm">
          <p className="font-medium">
            LambdaPP: Fast and accessible protein-specific phenotype predictions
          </p>
          <p className="text-xs text-muted-foreground">
            Olenyi T, Marquet C, Heinzinger M, et al. Protein Science 32, e4524
            (2023).
          </p>
          <a
            href="https://doi.org/10.1002/pro.4524"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            doi:10.1002/pro.4524
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <p className="text-sm">
          See{' '}
          <Link to="/cite" className="text-primary hover:underline">
            Cite
          </Link>{' '}
          for the full list of method references and{' '}
          <Link to="/methods" className="text-primary hover:underline">
            Methods
          </Link>{' '}
          for per-model attribution.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Acknowledgements</h2>
        <p className="text-sm text-muted-foreground">
          Prediction models rely on the UniRef50 corpus, the Gene Ontology,
          UniProtKB, and the AlphaFold Protein Structure Database. Development
          of protifer has been supported by research grants at TUM; funding
          sources are acknowledged in the corresponding publications.
        </p>
      </section>
    </article>
  )
}
