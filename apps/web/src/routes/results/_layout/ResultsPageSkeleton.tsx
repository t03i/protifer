import { Skeleton } from '#/components/ui/skeleton'

/**
 * Pending UI for routes whose loader resolves a sequence (e.g. the UniProt
 * fetch on `/results/uniprot/$accession`). Mirrors {@link ResultsPageShell}'s
 * layout so the real content swaps in with minimal shift.
 */
export function ResultsPageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading sequence…</span>
      <div className="space-y-3 rounded-lg border p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-16 w-full" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
