export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    /** Seconds (RFC 9110 §10.2.3). Set by retryable subclasses; drives `Retry-After`. */
    public readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, retryAfter)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

/**
 * Thrown (or constructed) when the gateway's admission controller refuses
 * a submission. `code` distinguishes `OVERLOADED` (queue over SLO) from
 * `UPSTREAM_DOWN` (Triton / embedding backend unresponsive).
 *
 * `retryAfter` is expressed in seconds (RFC 9110 §10.2.3). Error-handler
 * callers are responsible for coercing to a non-negative integer.
 */
export class SheddingError extends AppError {
  constructor(
    message: string,
    code: 'OVERLOADED' | 'UPSTREAM_DOWN',
    retryAfter?: number,
  ) {
    super(message, code, 503, retryAfter)
    this.name = 'SheddingError'
  }
}

export class OverloadedError extends SheddingError {
  constructor(message = 'Service overloaded', retryAfter?: number) {
    super(message, 'OVERLOADED', retryAfter)
    this.name = 'OverloadedError'
  }
}

export class UpstreamDownError extends SheddingError {
  constructor(message = 'Upstream backend unavailable', retryAfter?: number) {
    super(message, 'UPSTREAM_DOWN', retryAfter)
    this.name = 'UpstreamDownError'
  }
}
