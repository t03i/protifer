import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APIException } from '../http'
import { apiFetch } from './client'

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('throws APIException with code 401 on unauthorized response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 }),
    )
    await expect(apiFetch('/v1/test')).rejects.toThrow(APIException)
    await expect(apiFetch('/v1/test')).rejects.toMatchObject({ code: 401 })
  })

  it('returns the response for non-401 status codes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    )
    const res = await apiFetch('/v1/test')
    expect(res.status).toBe(200)
  })

  it('returns a 500 response without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 }),
    )
    const res = await apiFetch('/v1/test')
    expect(res.status).toBe(500)
  })
})
