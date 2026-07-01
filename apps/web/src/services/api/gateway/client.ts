import { APIException } from '../http'

const GATEWAY_URL = import.meta.env['VITE_GATEWAY_URL'] ?? ''

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  // Client-minted correlation id: the gateway honours a matching X-Request-Id
  // and stamps it on every pino line (→ Loki), so a frontend error and its
  // backend logs join on the same requestId. 32-hex satisfies the gateway's
  // ^[a-zA-Z0-9_-]{8,128}$ guard.
  const requestId = crypto.randomUUID().replaceAll('-', '')
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      ...init?.headers,
    },
  })
  if (res.status === 401) throw new APIException('Unauthorized', 401)
  return res
}
