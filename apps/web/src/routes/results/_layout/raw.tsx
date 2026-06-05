import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'

import { validateRawSearch } from './raw.schema'
import { ResultsPageShell } from './ResultsPageShell'

export const Route = createFileRoute('/results/_layout/raw')({
  validateSearch: validateRawSearch,
  component: RawResultsPage,
})

function RawResultsPage() {
  const { sequence, accession, model: modelParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  if (!sequence) {
    return <Navigate to="/" />
  }

  const handleModelChange = (modelId: string) => {
    void navigate({
      search: (prev) => ({ ...prev, model: modelId }),
      replace: true,
    })
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
