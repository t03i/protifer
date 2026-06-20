import { ConfigValidationError } from '@protifer/shared'
import { describe, expect, it } from 'vitest'

import { ConfigSchema, loadConfig } from './config.ts'

const VALID_ENV = {
  TRITON_URL: 'localhost:8001',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'redispw',
  GARAGE_ENDPOINT: 'http://localhost:3900',
  GARAGE_REGION: 'garage',
  GARAGE_BUCKET: 'predictions',
  GARAGE_ACCESS_KEY_ID: 'ak',
  GARAGE_SECRET_ACCESS_KEY: 'sk',
}

describe('prediction-worker loadConfig', () => {
  it('loads a valid env into a frozen typed config', () => {
    const cfg = loadConfig(VALID_ENV)
    expect(cfg.triton.url).toBe('localhost:8001')
    expect(cfg.triton.deadlineMs).toBe(90_000)
    expect(cfg.redis.password).toBe('redispw')
    expect(cfg.storage.bucket).toBe('predictions')
    expect(Object.isFrozen(cfg)).toBe(true)
  })

  it('applies conservative defaults for the fan-out tunables', () => {
    const cfg = loadConfig(VALID_ENV)
    expect(cfg.triton.maxInflightInfers).toBe(8)
    expect(cfg.triton.retryMaxAttempts).toBe(3)
    expect(cfg.triton.retryBaseBackoffMs).toBe(100)
  })

  it('parses env overrides for the fan-out tunables', () => {
    const cfg = loadConfig({
      ...VALID_ENV,
      TRITON_MAX_INFLIGHT_INFERS: '16',
      TRITON_RETRY_MAX_ATTEMPTS: '5',
      TRITON_RETRY_BASE_BACKOFF_MS: '250',
    })
    expect(cfg.triton.maxInflightInfers).toBe(16)
    expect(cfg.triton.retryMaxAttempts).toBe(5)
    expect(cfg.triton.retryBaseBackoffMs).toBe(250)
  })

  it('rejects a non-positive concurrency limit', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, TRITON_MAX_INFLIGHT_INFERS: '0' }),
    ).toThrow()
  })

  it('aggregates missing required fields into one error', () => {
    expect.assertions(2)
    try {
      loadConfig({})
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError)
      const err = e as ConfigValidationError
      const fields = err.issues.map((i) => i.envName)
      expect(fields).toEqual(
        expect.arrayContaining([
          'TRITON_URL',
          'REDIS_HOST',
          'REDIS_PASSWORD',
          'GARAGE_ENDPOINT',
          'GARAGE_BUCKET',
          'GARAGE_ACCESS_KEY_ID',
          'GARAGE_SECRET_ACCESS_KEY',
        ]),
      )
    }
  })

  it('describes secret vs config field kinds', () => {
    const docs = ConfigSchema.describe()
    expect(docs.find((d) => d.envName === 'GARAGE_ACCESS_KEY_ID')?.kind).toBe(
      'secret',
    )
    expect(docs.find((d) => d.envName === 'TRITON_URL')?.kind).toBe('config')
  })
})
