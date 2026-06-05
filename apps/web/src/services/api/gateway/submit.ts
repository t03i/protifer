import { APIException } from '../http.ts'
import { apiFetch } from './client.ts'

export async function submitPrediction(params: {
  sequence: string
  accession?: string
}): Promise<{ jobId: string }> {
  const { sequence, accession } = params
  const res = await apiFetch('/v1/predictions', {
    method: 'POST',
    body: JSON.stringify({ sequence, ...(accession && { accession }) }),
  })

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '60')
    throw new APIException(
      `Rate limit exceeded. Retry after ${retryAfter}s`,
      429,
      retryAfter,
    )
  }

  if (!res.ok) throw new APIException(res.statusText, res.status)

  return res.json() as Promise<{ jobId: string }>
}
