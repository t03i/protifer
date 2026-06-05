import { ArrowUpRight } from 'lucide-react'

interface Predecessor {
  name: string
  tagline: string
  years: string
  contribution: string
  href?: string
}

const predecessors: readonly Predecessor[] = [
  {
    name: 'PredictProtein',
    tagline:
      "The Rostlab's long-running protein-feature web server — one of the earliest large-scale sequence-annotation services.",
    years: 'since 1992',
    contribution:
      'Established the end-to-end flow from sequence to per-residue annotation that protifer carries forward.',
  },
  {
    name: 'LambdaPP',
    tagline:
      'The first Rostlab web service to replace evolutionary profiles with protein language model embeddings end-to-end.',
    years: '2022 – 2023',
    contribution:
      'Proved that a single pLM can drive many prediction heads. protifer inherits its model choice and prediction surface.',
  },
  {
    name: 'bio-embeddings',
    tagline:
      'The Python toolkit that made protein language model embeddings accessible to the community as reusable components.',
    years: '2020 – 2023',
    contribution:
      'Shaped how embedding pipelines are packaged. protifer re-implements its prediction heads as a production-grade service.',
    href: 'https://docs.bioembeddings.com/',
  },
]

const CARD_CLASSES =
  'group flex h-full flex-col gap-3 rounded-xl border bg-card p-5'

function PredecessorCard({ predecessor: p }: { predecessor: Predecessor }) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">{p.name}</h3>
        <span className="text-xs text-muted-foreground">{p.years}</span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {p.tagline}
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">Carries forward:</span>{' '}
        {p.contribution}
      </p>
      {p.href ? (
        <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
          Visit project
          <ArrowUpRight className="h-3 w-3" />
        </span>
      ) : (
        <span className="mt-auto text-xs text-muted-foreground">
          Succeeded by protifer
        </span>
      )}
    </>
  )

  if (p.href) {
    return (
      <a
        href={p.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${CARD_CLASSES} transition-colors hover:border-primary/40 hover:bg-card/80`}
      >
        {body}
      </a>
    )
  }

  return <div className={CARD_CLASSES}>{body}</div>
}

export function HistoricalLineage() {
  return (
    <section
      aria-labelledby="lineage-heading"
      className="rounded-2xl bg-brand-sky/20 px-6 py-16 sm:px-10"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Lineage
        </p>
        <h2
          id="lineage-heading"
          className="mb-3 text-2xl font-semibold tracking-tight"
        >
          Built on over three decades of Rostlab prediction tools
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          protifer succeeds three earlier Rostlab projects. Each shaped how
          sequence-only protein feature prediction is done today, and their
          prediction heads are consolidated here on a single protein
          language-model pipeline.
        </p>
      </div>

      <ol className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
        {predecessors.map((p) => (
          <li key={p.name}>
            <PredecessorCard predecessor={p} />
          </li>
        ))}
      </ol>
    </section>
  )
}
