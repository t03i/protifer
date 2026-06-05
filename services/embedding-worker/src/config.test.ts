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
  GARAGE_BUCKET: 'embeddings',
  GARAGE_ACCESS_KEY_ID: 'ak',
  GARAGE_SECRET_ACCESS_KEY: 'sk',
}

describe('embedding-worker loadConfig', () => {
  it('loads a valid env into a frozen typed config', () => {
    const cfg = loadConfig(VALID_ENV)
    expect(cfg.triton.url).toBe('localhost:8001')
    expect(cfg.triton.deadlineMs).toBe(90_000)
    expect(cfg.redis.host).toBe('localhost')
    expect(cfg.redis.port).toBe(6379)
    expect(cfg.redis.password).toBe('redispw')
    expect(cfg.storage.bucket).toBe('embeddings')
    expect(Object.isFrozen(cfg)).toBe(true)
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
    expect(docs.find((d) => d.envName === 'REDIS_PASSWORD')?.kind).toBe(
      'secret',
    )
    expect(docs.find((d) => d.envName === 'TRITON_URL')?.kind).toBe('config')
  })
})
