export class APIException extends Error {
  code: number
  retryAfter?: number

  constructor(message: string, code: number = 0, retryAfter?: number) {
    super(message)
    this.name = 'APIException'
    this.code = code
    this.retryAfter = retryAfter
  }
}

export class SequenceException extends Error {
  constructor(message: string, cause: unknown = null) {
    super(message)
    this.name = 'SequenceException'
    this.cause = cause
  }
}

export interface FetchOptions extends RequestInit {
  timeout?: number
}

export async function fetchWithTimeout(
  resource: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { timeout = 3000, ...fetchOptions } = options

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(resource, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(id)
  }
}
