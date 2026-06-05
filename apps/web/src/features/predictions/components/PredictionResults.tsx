import { Alert, AlertDescription } from '#/components/ui/alert'
import { Skeleton } from '#/components/ui/skeleton'
import { NightingaleViewer } from '#/features/interactive/components/NightingaleViewer'
import { VariantEffectHeatmap } from '#/features/interactive/components/VariantEffectHeatmap'
import { DownloadButton } from '#/features/predictions/components/DownloadButton'
import { SubcellularLocation } from '#/features/predictions/components/SubcellularLocation'
import { useSequenceContext } from '#/features/predictions/context/sequence-context'
import { useFeatures } from '#/features/predictions/hooks/use-features'

function LoadingSkeletons() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  )
}

export function PredictionResults() {
  const { sequence, accession } = useSequenceContext()
  const { data, isLoading, isError, error } = useFeatures(sequence, accession)

  if (isLoading) {
    return <LoadingSkeletons />
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error
            ? error.message
            : 'Failed to load predictions'}
        </AlertDescription>
      </Alert>
    )
  }

  if (!data) {
    return null
  }

  return (
    <div className="space-y-4">
      <SubcellularLocation
        location={data.predictedSubcellularLocalizations}
        membraneBound={data.predictedMembrane}
      />
      {/* Available for all input types */}
      <NightingaleViewer sequence={sequence} predictions={data} />

      <VariantEffectHeatmap
        sequence={sequence}
        variation={data.predictedVariation}
      />

      <div className="flex justify-end">
        <DownloadButton data={data} sequence={sequence} />
      </div>
    </div>
  )
}
