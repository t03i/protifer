import { APIException } from '../http'

const GATEWAY_URL = import.meta.env['VITE_GATEWAY_URL'] ?? ''

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (res.status === 401) throw new APIException('Unauthorized', 401)
  return res
}
