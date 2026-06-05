import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { apiFetch } from '#/services/api/gateway/client'
import { APIException } from '#/services/api/http'

const FOLDSEEK_DATABASES = ['pdb100', 'afdb50', 'afdb-swissprot'] as const

async function submitFoldseekTicket(params: {
  model_url: string
  databases: string[]
}): Promise<{ ticketId: string }> {
  const res = await apiFetch('/v1/foldseek', {
    method: 'POST',
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new APIException(
      (err as { error?: string }).error ?? 'Foldseek request failed',
      res.status,
    )
  }
  return res.json()
}

interface Props {
  modelUrl?: string
}

export function FoldSeekButton({ modelUrl }: Props) {
  const completedRef = useRef(false)

  const { mutate, isPending } = useMutation({
    mutationFn: submitFoldseekTicket,
    onSuccess: (data) => {
      completedRef.current = true
      window.open(
        `https://search.foldseek.com/result/${data.ticketId}/0`,
        '_blank',
      )
    },
    onError: (err) => {
      completedRef.current = true
      toast.error(err.message || 'Foldseek search failed')
    },
  })

  const isDisabled = !modelUrl || isPending || completedRef.current

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isDisabled}
      onClick={() => {
        if (modelUrl) {
          mutate({ model_url: modelUrl, databases: [...FOLDSEEK_DATABASES] })
        }
      }}
    >
      {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      FoldSeek
    </Button>
  )
}
