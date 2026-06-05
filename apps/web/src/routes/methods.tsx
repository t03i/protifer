import { createFileRoute } from '@tanstack/react-router'

import { MethodCard } from '#/components/marketing/MethodCard'
import { methods } from '#/content/methods'

export const Route = createFileRoute('/methods')({
  component: MethodsPage,
})

function MethodsPage() {
  return (
    <article className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Methods</h1>
        <p className="text-muted-foreground">
          Every prediction you see on this site is produced by a peer-reviewed,
          published machine-learning method built on protein language model
          embeddings. Each card summarises what a method does, what it consumes,
          and where to find the primary publication.
        </p>
      </header>

      <nav aria-label="Methods jump links" className="flex flex-wrap gap-2">
        {methods.map((m) => (
          <a
            key={m.slug}
            href={`#${m.slug}`}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {m.name}
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {methods.map((m) => (
          <MethodCard key={m.slug} method={m} />
        ))}
      </div>
    </article>
  )
}
