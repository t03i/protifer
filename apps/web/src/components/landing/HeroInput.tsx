import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { ExampleSequenceChips } from '#/features/input/components/ExampleSequenceChips'
import { useInputValidation } from '#/features/input/hooks/use-input-validation'
import { useSequence } from '#/features/input/hooks/use-sequence'

export function HeroInput() {
  const [value, setValue] = useState('')
  const navigate = useNavigate()
  const { isValid, type } = useInputValidation(value)
  const { refetch, isFetching } = useSequence(type, value)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!isValid) return

      if (type === 'uniprot_id') {
        void navigate({
          to: '/results/uniprot/$accession',
          params: { accession: value.trim() },
        })
        return
      }

      const result = await refetch()
      if (result.error) {
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
          search: { sequence: result.data.sequence },
        })
      }
    },
    [isValid, type, value, refetch, navigate],
  )

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3">
      <form
        onSubmit={handleSubmit}
        className="flex w-full gap-2"
        aria-label="Quick protein prediction"
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. P04637"
          className="bg-white/80"
          aria-label="UniProt accession or sequence"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" disabled={!isValid || isFetching}>
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Predict'
          )}
        </Button>
      </form>
      <ExampleSequenceChips onSelect={(next) => setValue(next)} />
    </div>
  )
}
