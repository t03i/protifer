import { useTheme } from 'next-themes'
import { useCallback, useState } from 'react'
import { ZodError } from 'zod'

import { FoldSeekButton } from './FoldSeekButton'
import { MolstarViewer } from './MolstarViewer'

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { useVisualizationRefs } from '#/features/structure/context/visualization-refs'
import { useResidueSync } from '#/features/structure/hooks/use-residue-sync'
import { useStructure } from '#/features/structure/hooks/use-structure'

interface Props {
  accession: string
  selectedModel?: string
  onModelChange?: (modelId: string) => void
}

export function StructurePanel({
  accession,
  selectedModel,
  onModelChange,
}: Props) {
  const { data, isLoading, isError, error } = useStructure(accession)
  const { resolvedTheme } = useTheme()
  const structures = data?.structures ?? []
  const isZodError = error instanceof ZodError

  const { molstarRef } = useVisualizationRefs()
  const [molstarReady, setMolstarReady] = useState(false)

  const handleReady = useCallback((ready: boolean) => {
    setMolstarReady(ready)
  }, [])

  useResidueSync(molstarRef, molstarReady)

  const matchIdx = structures.findIndex(
    (s) => s.summary.model_identifier === selectedModel,
  )

  if (selectedModel !== undefined && matchIdx === -1 && structures.length > 0) {
    console.warn(
      `Invalid model param "${selectedModel}", falling back to default: "${structures[0]?.summary.model_identifier}"`,
    )
  }

  const resolvedIdx = matchIdx >= 0 ? matchIdx : 0
  const resolvedStructure = structures[resolvedIdx]?.summary

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">3D Structure</h3>
        <FoldSeekButton modelUrl={resolvedStructure?.model_url} />
      </div>

      {isLoading && <Skeleton className="h-96 w-full rounded-md" />}

      {isZodError && (
        <Alert variant="destructive">
          <AlertTitle>Structure data format error</AlertTitle>
          <AlertDescription>
            The 3D structure response was in an unexpected format. Try
            refreshing the page.
          </AlertDescription>
        </Alert>
      )}

      {isError && !isZodError && (
        <Alert>
          <AlertDescription>
            No structure available for this accession.
          </AlertDescription>
        </Alert>
      )}

      {structures.length > 1 && (
        <Select
          value={resolvedStructure?.model_identifier}
          onValueChange={(val) => onModelChange?.(val)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {structures.map((s) => (
              <SelectItem
                key={s.summary.model_identifier}
                value={s.summary.model_identifier}
              >
                {s.summary.provider} — {s.summary.model_identifier}
                {s.summary.confidence_avg !== undefined &&
                  ` (${s.summary.confidence_avg.toFixed(1)})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {resolvedStructure && (
        <MolstarViewer
          key={`${resolvedTheme ?? 'light'}-${resolvedStructure.model_identifier}`}
          structure={resolvedStructure}
          resolvedTheme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          onReady={handleReady}
        />
      )}

      {resolvedStructure && (
        <p className="text-xs text-muted-foreground">
          Source:{' '}
          {resolvedStructure.model_page_url ? (
            <a
              href={resolvedStructure.model_page_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              {resolvedStructure.provider}
            </a>
          ) : (
            resolvedStructure.provider
          )}{' '}
          · Format: {resolvedStructure.model_format}
          {resolvedStructure.confidence_avg !== undefined &&
            ` · Avg. confidence: ${resolvedStructure.confidence_avg.toFixed(1)}`}
        </p>
      )}
    </div>
  )
}
