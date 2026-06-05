import type { PollResponse } from '@protifer/shared'

import { APIException } from '../http.ts'
import { apiFetch } from './client.ts'

export async function fetchPredictionStatus(
  jobId: string,
  signal: AbortSignal,
): Promise<PollResponse> {
  const res = await apiFetch(`/v1/predictions/${jobId}`, { signal })

  if (!res.ok) throw new APIException(res.statusText, res.status)

  return res.json() as Promise<PollResponse>
}
