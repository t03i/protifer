import { UniProtEnrichment } from '#/features/enrichment/components/UniProtEnrichment'
import { SequenceDisplay } from '#/features/input/components/SequenceDisplay'
import { PredictionResults } from '#/features/predictions/components/PredictionResults'
import { SequenceContext } from '#/features/predictions/context/sequence-context'
import { SelectionProvider } from '#/features/structure/context/selection'
import { VisualizationRefsProvider } from '#/features/structure/context/visualization-refs'

interface ResultsPageShellProps {
  sequence: string
  accession?: string
  selectedModel?: string
  onModelChange: (modelId: string) => void
}

export function ResultsPageShell({
  sequence,
  accession,
  selectedModel,
  onModelChange,
}: ResultsPageShellProps) {
  return (
    <SequenceContext.Provider value={{ sequence, accession }}>
      <VisualizationRefsProvider>
        <SelectionProvider>
          <div className="space-y-4">
            <SequenceDisplay sequence={sequence} accession={accession} />
            {accession && (
              <UniProtEnrichment
                accession={accession}
                selectedModel={selectedModel}
                onModelChange={onModelChange}
              />
            )}
            <PredictionResults />
          </div>
        </SelectionProvider>
      </VisualizationRefsProvider>
    </SequenceContext.Provider>
  )
}
