import { Download } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { useSequenceContext } from '#/features/predictions/context/sequence-context'
import { downloadData } from '#/lib/download'
import type { PredictionResponse } from '#/types/features'

interface Props {
  data: PredictionResponse
  sequence: string
}

export function DownloadButton({ data, sequence }: Props) {
  const { accession } = useSequenceContext()

  const handleDownload = () => {
    const payload = JSON.stringify(
      {
        sequence,
        ...(accession ? { accession } : {}),
        predictions: data,
      },
      null,
      2,
    )
    downloadData(payload, `protifer_predictions_${sequence.slice(0, 10)}.json`)
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDownload}>
      <Download className="mr-2 h-4 w-4" />
      Download JSON
    </Button>
  )
}
