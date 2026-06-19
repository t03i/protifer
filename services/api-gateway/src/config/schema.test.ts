import { ConfigValidationError } from '@protifer/shared'
import { describe, it, expect } from 'vitest'

import {
  ConfigSchema,
  loadConfig,
  loadOpsKeyConfig,
  ProductionConfigError,
  assertProductionInvariants,
} from './schema.ts'

const VALID_ENV = {
  NODE_ENV: 'development',
  PORT: '3001',
  BETTER_AUTH_SECRET: '0123456789abcdef',
  BETTER_AUTH_BASE_URL: 'http://localhost:9090',
  GITHUB_CLIENT_ID: 'gh-id',
  GITHUB_CLIENT_SECRET: 'gh-secret',
  DATABASE_URL: 'postgresql://localhost:5432/db',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:3000',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'redispw',
  TRITON_URL: 'localhost:8001',
  GARAGE_ENDPOINT: 'http://localhost:3900',
  GARAGE_REGION: 'garage',
  GARAGE_BUCKET: 'protifer',
  GARAGE_ACCESS_KEY_ID: 'ak',
  GARAGE_SECRET_ACCESS_KEY: 'sk',
}

describe('loadConfig', () => {
  it('loads a valid development env', () => {
    const cfg = loadConfig(VALID_ENV)
    expect(cfg.env.nodeEnv).toBe('development')
    expect(cfg.env.port).toBe(3001)
    expect(cfg.cors.origins).toEqual([
      'http://localhost:5173',
      'http://localhost:3000',
    ])
    expect(cfg.database.url).toBe('postgresql://localhost:5432/db')
    expect(cfg.shedding.mode).toBe('shadow')
  })

  it('returns frozen config', () => {
    const cfg = loadConfig(VALID_ENV)
    expect(Object.isFrozen(cfg)).toBe(true)
    expect(Object.isFrozen(cfg.cors)).toBe(true)
  })

  it('aggregates missing fields', () => {
    expect.assertions(2)
    try {
      loadConfig({})
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError)
      const err = e as ConfigValidationError
      expect(err.issues.length).toBeGreaterThan(5)
    }
  })

  it('production rejects localhost in BETTER_AUTH_BASE_URL', () => {
    expect.assertions(2)
    try {
      loadConfig({ ...VALID_ENV, NODE_ENV: 'production' })
    } catch (e) {
      expect(e).toBeInstanceOf(ProductionConfigError)
      const err = e as ProductionConfigError
      expect(err.issues.some((i) => i.includes('BETTER_AUTH_BASE_URL'))).toBe(
        true,
      )
    }
  })

  it('production rejects http:// non-localhost BETTER_AUTH_BASE_URL', () => {
    expect.assertions(2)
    try {
      loadConfig({
        ...VALID_ENV,
        NODE_ENV: 'production',
        BETTER_AUTH_BASE_URL: 'http://api.example.com',
        CORS_ORIGINS: 'https://app.example.com',
      })
    } catch (e) {
      expect(e).toBeInstanceOf(ProductionConfigError)
      const err = e as ProductionConfigError
      expect(
        err.issues.some(
          (i) => i.includes('BETTER_AUTH_BASE_URL') && i.includes('https'),
        ),
      ).toBe(true)
    }
  })

  it('production rejects http:// CORS origins', () => {
    expect.assertions(2)
    try {
      loadConfig({
        ...VALID_ENV,
        NODE_ENV: 'production',
        BETTER_AUTH_BASE_URL: 'https://api.example.com',
        CORS_ORIGINS: 'https://app.example.com,http://other.example.com',
      })
    } catch (e) {
      expect(e).toBeInstanceOf(ProductionConfigError)
      const err = e as ProductionConfigError
      expect(
        err.issues.some(
          (i) => i.includes('CORS_ORIGINS') && i.includes('http://other'),
        ),
      ).toBe(true)
    }
  })

  const PROD_ENV = {
    ...VALID_ENV,
    NODE_ENV: 'production',
    BETTER_AUTH_BASE_URL: 'https://api.example.com',
    CORS_ORIGINS: 'https://app.example.com,https://*.example.com',
    MODEL_ARTIFACT_REF: `ghcr.io/org/model-repo@sha256:${'a'.repeat(64)}`,
  }

  it('production requires a digest-pinned MODEL_ARTIFACT_REF', () => {
    expect.assertions(2)
    try {
      loadConfig({ ...PROD_ENV, MODEL_ARTIFACT_REF: '' })
    } catch (e) {
      expect(e).toBeInstanceOf(ProductionConfigError)
      const err = e as ProductionConfigError
      expect(err.issues.some((i) => i.includes('MODEL_ARTIFACT_REF'))).toBe(
        true,
      )
    }
  })

  it('production rejects a mutable-tag MODEL_ARTIFACT_REF', () => {
    expect.assertions(2)
    try {
      loadConfig({
        ...PROD_ENV,
        MODEL_ARTIFACT_REF: 'ghcr.io/org/model-repo:v1',
      })
    } catch (e) {
      expect(e).toBeInstanceOf(ProductionConfigError)
      const err = e as ProductionConfigError
      expect(err.issues.some((i) => i.includes('digest-pinned'))).toBe(true)
    }
  })

  it('production passes with valid values', () => {
    const cfg = loadConfig(PROD_ENV)
    expect(cfg.env.nodeEnv).toBe('production')
    expect(() => {
      assertProductionInvariants(cfg)
    }).not.toThrow()
  })

  it('rate-limit submission ceilings default to PLAN_LIMITS and are env-overridable', () => {
    const def = loadConfig(VALID_ENV)
    expect(def.rateLimit.submissionsFree).toBe(10)
    expect(def.rateLimit.submissionsPro).toBe(60)

    const over = loadConfig({
      ...VALID_ENV,
      RATE_LIMIT_SUBMISSIONS_PRO: '5000',
    })
    expect(over.rateLimit.submissionsPro).toBe(5000)
    expect(over.rateLimit.submissionsFree).toBe(10)
  })

  it('describes every field with kind metadata', () => {
    const docs = ConfigSchema.describe()
    expect(docs.length).toBeGreaterThan(15)
    const garageKey = docs.find((d) => d.envName === 'GARAGE_ACCESS_KEY_ID')
    expect(garageKey?.kind).toBe('secret')
    const port = docs.find((d) => d.envName === 'PORT')
    expect(port?.kind).toBe('config')
    expect(port?.hasDefault).toBe(true)
  })
})

describe('loadOpsKeyConfig', () => {
  const OPS_ENV = {
    BETTER_AUTH_SECRET: '0123456789abcdef',
    BETTER_AUTH_BASE_URL: 'http://localhost:9090',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    CORS_ORIGINS: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://localhost:5432/db',
  }

  it('loads auth/cors/database without the gateway infra config', () => {
    // No GARAGE_*/REDIS_*/TRITON_* — ops-key must not require them.
    const cfg = loadOpsKeyConfig(OPS_ENV)
    expect(cfg.database.url).toBe('postgresql://localhost:5432/db')
    expect(cfg.auth.githubClientId).toBe('gh-id')
    expect(cfg.cors.origins).toEqual(['http://localhost:5173'])
  })

  it('still reports missing auth fields', () => {
    expect(() =>
      loadOpsKeyConfig({ DATABASE_URL: 'postgresql://x/y' }),
    ).toThrow(ConfigValidationError)
  })
})
