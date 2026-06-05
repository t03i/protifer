import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect } from 'react'

import { isDemoInput, loadDemoPrediction } from '#/lib/demo.ts'
import { PREDICTIONS_STALE_TIME } from '#/lib/query-config'
import {
  fetchPredictionStatus,
  submitPrediction,
} from '#/services/api/gateway/index.ts'
import { APIException } from '#/services/api/http.ts'
import { transformStoredPrediction } from '#/services/transform/stored-prediction.ts'
import type { PredictionResponse } from '#/types/features.ts'

export function featuresQueryOptions(sequence: string | undefined) {
  return queryOptions<PredictionResponse>({
    queryKey: ['features', sequence] as const,
    queryFn: (): never => {
      throw new Error('unreachable')
    },
    enabled: false,
    staleTime: PREDICTIONS_STALE_TIME,
  })
}

export function useFeatures(sequence: string | undefined, accession?: string) {
  const queryClient = useQueryClient()

  const { data } = useQuery(featuresQueryOptions(sequence))

  const {
    mutate: submit,
    data: submitData,
    isPending: isSubmitting,
    error: submitError,
  } = useMutation({ mutationFn: submitPrediction })

  useEffect(() => {
    if (
      !sequence ||
      queryClient.getQueryData(featuresQueryOptions(sequence).queryKey)
    ) {
      return
    }
    if (isDemoInput({ accession, sequence })) {
      let cancelled = false
      loadDemoPrediction({ accession, sequence })
        .then((stored) => {
          if (cancelled) return
          queryClient.setQueryData(
            featuresQueryOptions(sequence).queryKey,
            transformStoredPrediction(stored),
          )
        })
        .catch(() => {
          // On failure to load the static artifact (missing/index not built),
          // fall back to the live pipeline so the user still sees *something*.
          if (!cancelled) submit({ sequence, accession })
        })
      return () => {
        cancelled = true
      }
    }
    submit({ sequence, accession })
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps -- submit and queryClient are stable refs in TQ v5
  }, [sequence])

  const jobId = submitData?.jobId

  const { data: pollData, error: pollError } = useQuery({
    queryKey: ['prediction-poll', jobId] as const,
    queryFn: ({ signal }) => fetchPredictionStatus(jobId!, signal),
    enabled: !!jobId && !data,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (
        !status ||
        status === 'complete' ||
        status === 'failed' ||
        status === 'not_found'
      )
        return false
      return status === 'processing' ? 3_000 : 1_000
    },
    staleTime: 0,
    retry: false,
  })

  useEffect(() => {
    if (pollData?.status === 'complete' && pollData.result && sequence) {
      queryClient.setQueryData(
        featuresQueryOptions(sequence).queryKey,
        transformStoredPrediction(pollData.result),
      )
    }
  }, [pollData, sequence, queryClient])

  const error: Error | null =
    submitError ??
    (pollData?.status === 'failed' || pollData?.status === 'not_found'
      ? new APIException(pollData.error ?? 'Prediction failed', 500)
      : null) ??
    pollError ??
    null

  const isLoading = !data && !error && (isSubmitting || !!jobId)

  return {
    data,
    isLoading,
    isError: !!error,
    error,
  }
}
