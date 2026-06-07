import { ConfigValidationError } from '@protifer/shared'
import { describe, it, expect } from 'vitest'

import {
  ConfigSchema,
  loadConfig,
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
  GARAGE_RPC_SECRET: 'a'.repeat(64),
  GARAGE_ADMIN_TOKEN: 'admin-token-xyz',
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

  it('production rejects dev Garage placeholders', () => {
    expect.assertions(3)
    try {
      loadConfig({
        ...VALID_ENV,
        NODE_ENV: 'production',
        BETTER_AUTH_BASE_URL: 'https://api.example.com',
        CORS_ORIGINS: 'https://app.example.com',
        GARAGE_RPC_SECRET: '0'.repeat(64),
        GARAGE_ADMIN_TOKEN: 'dev-admin-token',
      })
    } catch (e) {
      expect(e).toBeInstanceOf(ProductionConfigError)
      const err = e as ProductionConfigError
      expect(err.issues.some((i) => i.includes('GARAGE_RPC_SECRET'))).toBe(true)
      expect(err.issues.some((i) => i.includes('GARAGE_ADMIN_TOKEN'))).toBe(
        true,
      )
    }
  })

  it('production rejects DEV_OVERRIDE_AUTH=true', () => {
    expect.assertions(2)
    try {
      loadConfig({
        ...VALID_ENV,
        NODE_ENV: 'production',
        BETTER_AUTH_BASE_URL: 'https://api.example.com',
        CORS_ORIGINS: 'https://app.example.com',
        GARAGE_RPC_SECRET: 'a'.repeat(64),
        GARAGE_ADMIN_TOKEN: 'real-admin-token-xyz',
        DEV_OVERRIDE_AUTH: 'true',
      })
    } catch (e) {
      expect(e).toBeInstanceOf(ProductionConfigError)
      const err = e as ProductionConfigError
      expect(err.issues.some((i) => i.includes('DEV_OVERRIDE_AUTH'))).toBe(true)
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
        GARAGE_RPC_SECRET: 'a'.repeat(64),
        GARAGE_ADMIN_TOKEN: 'real-admin-token-xyz',
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
        GARAGE_RPC_SECRET: 'a'.repeat(64),
        GARAGE_ADMIN_TOKEN: 'real-admin-token-xyz',
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
    GARAGE_RPC_SECRET: 'a'.repeat(64),
    GARAGE_ADMIN_TOKEN: 'real-admin-token-xyz',
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

  it('describes every field with kind metadata', () => {
    const docs = ConfigSchema.describe()
    expect(docs.length).toBeGreaterThan(15)
    const garageRpc = docs.find((d) => d.envName === 'GARAGE_RPC_SECRET')
    expect(garageRpc?.kind).toBe('secret')
    const port = docs.find((d) => d.envName === 'PORT')
    expect(port?.kind).toBe('config')
    expect(port?.hasDefault).toBe(true)
  })
})
