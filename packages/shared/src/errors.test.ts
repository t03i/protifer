import { describe, it, expect } from 'vitest'

import {
  AppError,
  OverloadedError,
  RateLimitError,
  NotFoundError,
  SheddingError,
  UpstreamDownError,
  ValidationError,
} from './errors.ts'

describe('error hierarchy', () => {
  it('AppError is an Error', () => {
    const e = new AppError('msg', 'CODE', 400)
    expect(e).toBeInstanceOf(Error)
    expect(e.statusCode).toBe(400)
    expect(e.code).toBe('CODE')
  })

  it('RateLimitError has 429 status', () => {
    const e = new RateLimitError('too many', 30)
    expect(e.statusCode).toBe(429)
    expect(e.retryAfter).toBe(30)
  })

  it('NotFoundError has 404 status', () => {
    expect(new NotFoundError('gone').statusCode).toBe(404)
  })

  it('ValidationError has 400 status', () => {
    expect(new ValidationError('bad').statusCode).toBe(400)
  })

  it('SheddingError carries code + retryAfter and maps to 503', () => {
    const e = new SheddingError('queued too long', 'OVERLOADED', 42)
    expect(e.statusCode).toBe(503)
    expect(e.code).toBe('OVERLOADED')
    expect(e.retryAfter).toBe(42)
    expect(e).toBeInstanceOf(AppError)
  })

  it('OverloadedError defaults to code=OVERLOADED', () => {
    const e = new OverloadedError('ov', 10)
    expect(e.statusCode).toBe(503)
    expect(e.code).toBe('OVERLOADED')
    expect(e.retryAfter).toBe(10)
    expect(e).toBeInstanceOf(SheddingError)
  })

  it('UpstreamDownError defaults to code=UPSTREAM_DOWN', () => {
    const e = new UpstreamDownError('triton down', 60)
    expect(e.statusCode).toBe(503)
    expect(e.code).toBe('UPSTREAM_DOWN')
    expect(e.retryAfter).toBe(60)
    expect(e).toBeInstanceOf(SheddingError)
  })
})
