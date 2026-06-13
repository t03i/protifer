import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { ResultsPageShell } from '../ResultsPageShell'
import { ResultsPageSkeleton } from '../ResultsPageSkeleton'

import { fetchSequenceById } from '#/services/api/uniprot'

interface AccessionSearch {
  model?: string
}

export const Route = createFileRoute('/results/_layout/uniprot/$accession')({
  loader: ({ params }) => fetchSequenceById(params.accession),
  validateSearch: (search: Record<string, unknown>): AccessionSearch => ({
    model: typeof search.model === 'string' ? search.model : undefined,
  }),
  pendingComponent: ResultsPageSkeleton,
  component: UniprotResultsPage,
})

function UniprotResultsPage() {
  const { sequence, accession } = Route.useLoaderData()
  const { model: modelParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const handleModelChange = (modelId: string) => {
    void navigate({ search: { model: modelId }, replace: true })
  }

  return (
    <ResultsPageShell
      sequence={sequence}
      accession={accession}
      selectedModel={modelParam}
      onModelChange={handleModelChange}
    />
  )
}
