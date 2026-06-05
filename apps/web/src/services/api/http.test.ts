import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APIException, fetchWithTimeout } from './http'

describe('APIException', () => {
  it('stores message and code', () => {
    const err = new APIException('not found', 404)
    expect(err.message).toBe('not found')
    expect(err.code).toBe(404)
    expect(err.name).toBe('APIException')
  })
})

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('passes through a successful fetch', async () => {
    const mockResponse = new Response('ok', { status: 200 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const res = await fetchWithTimeout('https://example.com')
    expect(res.status).toBe(200)
  })

  it('aborts on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, options) =>
        new Promise((_, reject) => {
          const signal = options?.signal
          if (signal) {
            signal.addEventListener('abort', () =>
              reject(
                new DOMException('The operation was aborted.', 'AbortError'),
              ),
            )
          }
        }),
    )

    await expect(
      fetchWithTimeout('https://example.com', { timeout: 10 }),
    ).rejects.toThrow()
  })
})
