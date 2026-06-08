import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { ExampleSequenceChips } from './ExampleSequenceChips'
import { useInputValidation } from '../hooks/use-input-validation'
import { useSequence } from '../hooks/use-sequence'

import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { logger } from '#/lib/logger'
import { describeSequence } from '#/lib/sequence-descriptor'
import { InputAlphabet } from '#/types/sequence'

export function SequenceInput() {
  const [input, setInput] = useState('')
  const navigate = useNavigate()
  const { isValid, type, alphabet } = useInputValidation(input)

  const { refetch, isFetching } = useSequence(type, input)

  const handleSubmit = useCallback(async () => {
    if (!isValid) return

    if (type === 'uniprot_id') {
      void navigate({
        to: '/results/uniprot/$accession',
        params: { accession: input.trim() },
      })
      return
    }

    const result = await refetch()
    if (result.error) {
      logger.error('Sequence resolution failed', result.error, {
        ...(await describeSequence(input)),
        type,
      })
      toast.error('Could not resolve sequence. Please check your input.')
      return
    }
    if (!result.data) return

    if (type === 'uniprot_protein_name') {
      void navigate({
        to: '/results/uniprot/$accession',
        params: { accession: result.data.accession! },
      })
    } else {
      void navigate({
        to: '/results/raw',
        search: {
          sequence: result.data.sequence,
          ...(result.data.accession
            ? { accession: result.data.accession }
            : {}),
        },
      })
    }
  }, [isValid, type, input, refetch, navigate])

  return (
    <div className="space-y-2">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter protein sequence, UniProt ID, or FASTA..."
        rows={6}
        className="font-mono"
      />

      {alphabet === InputAlphabet.iupac_extended && (
        <Alert variant="destructive">
          <AlertDescription>
            Extended IUPAC characters (B, Z, J, U, O) will be mapped to X.
          </AlertDescription>
        </Alert>
      )}

      <ExampleSequenceChips onSelect={(next) => setInput(next)} />

      <div className="flex items-center gap-2 justify-end">
        <Button onClick={handleSubmit} disabled={!isValid || isFetching}>
          {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Predict
        </Button>
        <Button
          variant="outline"
          onClick={() => setInput('')}
          disabled={!input}
        >
          Clear
        </Button>
      </div>
    </div>
  )
}
