import { useMatch } from '@tanstack/react-router'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { StructurePanel } from '#/features/structure/components/StructurePanel'
import { UniRefClusters } from '#/features/uniref/components/UniRefClusters'

interface Props {
  accession: string
  selectedModel?: string
  onModelChange?: (modelId: string) => void
}

export function UniProtEnrichment({
  accession,
  selectedModel,
  onModelChange,
}: Props) {
  const rawMatch = useMatch({
    from: '/results/_layout/raw',
    shouldThrow: false,
  })
  const isUserSubmittedSequence = rawMatch != null

  return (
    <div className="space-y-4">
      {isUserSubmittedSequence && (
        <Alert>
          <AlertDescription>
            Annotations shown for UniProt{' '}
            <span className="font-mono">{accession}</span>. Your submitted
            sequence may differ from the canonical entry.
          </AlertDescription>
        </Alert>
      )}
      <StructurePanel
        accession={accession}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
      />
      <UniRefClusters accession={accession} />
    </div>
  )
}
