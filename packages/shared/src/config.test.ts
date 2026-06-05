import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

import {
  readConfig,
  ConfigReadError,
  ConfigValidationError,
  secretField,
  configField,
  customSection,
  defineConfig,
  zBooleanString,
  zCsv,
} from './config.ts'

describe('readConfig', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'config-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns env value when env is set', () => {
    expect(readConfig('PORT', { PORT: '3000' })).toBe('3000')
  })

  it('prefers env over FILE', () => {
    const filePath = path.join(tempDir, 'p')
    writeFileSync(filePath, 'from-file')
    const env = { PORT: 'from-env', PORT_FILE: filePath }
    expect(readConfig('PORT', env)).toBe('from-env')
  })

  it('falls back to FILE when env is unset', () => {
    const filePath = path.join(tempDir, 'p')
    writeFileSync(filePath, 'from-file')
    expect(readConfig('PORT', { PORT_FILE: filePath })).toBe('from-file')
  })

  it('returns undefined when neither source is set', () => {
    expect(readConfig('PORT', {})).toBeUndefined()
  })

  it('returns undefined when env is empty string', () => {
    expect(readConfig('PORT', { PORT: '' })).toBeUndefined()
  })

  it('throws ConfigReadError when FILE is unreadable', () => {
    expect(() => readConfig('PORT', { PORT_FILE: '/no/such/file' })).toThrow(
      ConfigReadError,
    )
  })

  it('trims trailing whitespace from file content', () => {
    const filePath = path.join(tempDir, 'p')
    writeFileSync(filePath, '8080\n')
    expect(readConfig('PORT', { PORT_FILE: filePath })).toBe('8080')
  })
})

describe('field helpers', () => {
  it('secretField requires a non-empty description', () => {
    expect(() =>
      secretField({ envName: 'X', description: '', type: z.string() }),
    ).toThrow(/description is required/)
  })

  it('configField requires a non-empty description', () => {
    expect(() =>
      configField({ envName: 'X', description: '   ', type: z.string() }),
    ).toThrow(/description is required/)
  })

  it('configField accepts a default', () => {
    const f = configField({
      envName: 'X',
      description: 'x',
      type: z.string(),
      default: 'hello',
    })
    expect(f.hasDefault).toBe(true)
    expect(f.defaultValue).toBe('hello')
  })
})

describe('defineConfig', () => {
  const Schema = defineConfig({
    env: {
      port: configField({
        envName: 'PORT',
        description: 'HTTP port',
        type: z.coerce.number().int().positive(),
        default: 3001,
      }),
      nodeEnv: configField({
        envName: 'NODE_ENV',
        description: 'Node environment',
        type: z.enum(['development', 'production', 'test']),
        default: 'development',
      }),
    },
    database: {
      url: configField({
        envName: 'DATABASE_URL',
        description: 'Postgres connection string',
        type: z.url(),
      }),
      password: secretField({
        envName: 'POSTGRES_PASSWORD',
        description: 'Postgres user password',
        type: z.string().min(1),
      }),
    },
  })

  it('loads valid config and returns a frozen typed object', () => {
    const cfg = Schema.load({
      DATABASE_URL: 'postgresql://localhost/db',
      POSTGRES_PASSWORD: 'secret',
      PORT: '8080',
    })
    expect(cfg.env.port).toBe(8080)
    expect(cfg.env.nodeEnv).toBe('development')
    expect(cfg.database.url).toBe('postgresql://localhost/db')
    expect(cfg.database.password).toBe('secret')
    expect(Object.isFrozen(cfg)).toBe(true)
    expect(Object.isFrozen(cfg.env)).toBe(true)
    expect(Object.isFrozen(cfg.database)).toBe(true)
  })

  it('applies declared defaults when env is unset', () => {
    const cfg = Schema.load({
      DATABASE_URL: 'postgresql://localhost/db',
      POSTGRES_PASSWORD: 'secret',
    })
    expect(cfg.env.port).toBe(3001)
    expect(cfg.env.nodeEnv).toBe('development')
  })

  it('aggregates multiple validation issues into one error', () => {
    expect.assertions(3)
    try {
      Schema.load({})
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError)
      const err = e as ConfigValidationError
      expect(err.issues.length).toBeGreaterThanOrEqual(2)
      const fields = err.issues.map((i) => i.envName)
      expect(fields).toEqual(
        expect.arrayContaining(['DATABASE_URL', 'POSTGRES_PASSWORD']),
      )
    }
  })

  it('reports invalid Zod values with field path', () => {
    expect.assertions(2)
    try {
      Schema.load({
        DATABASE_URL: 'not-a-url',
        POSTGRES_PASSWORD: 'x',
      })
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError)
      const err = e as ConfigValidationError
      const issue = err.issues.find((i) => i.envName === 'DATABASE_URL')
      expect(issue?.path).toEqual(['database', 'url'])
    }
  })

  it('describes every field with path, kind, type, default repr', () => {
    const docs = Schema.describe()
    expect(docs.length).toBe(4)
    const port = docs.find((d) => d.envName === 'PORT')
    expect(port?.path).toEqual(['env', 'port'])
    expect(port?.kind).toBe('config')
    expect(port?.hasDefault).toBe(true)
    expect(port?.defaultRepr).toBe('3001')
    const pw = docs.find((d) => d.envName === 'POSTGRES_PASSWORD')
    expect(pw?.kind).toBe('secret')
    expect(pw?.hasDefault).toBe(false)
  })

  it('reads secrets from FILE first when both env and FILE are set', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'secrets-cfg-'))
    try {
      const filePath = path.join(tempDir, 'pw')
      writeFileSync(filePath, 'from-file')
      const cfg = Schema.load({
        DATABASE_URL: 'postgresql://localhost/db',
        POSTGRES_PASSWORD: 'from-env',
        POSTGRES_PASSWORD_FILE: filePath,
      })
      expect(cfg.database.password).toBe('from-file')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('reads config with env winning over FILE', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'cfg-cfg-'))
    try {
      const filePath = path.join(tempDir, 'p')
      writeFileSync(filePath, '9090')
      const cfg = Schema.load({
        DATABASE_URL: 'postgresql://localhost/db',
        POSTGRES_PASSWORD: 'x',
        PORT: '8080',
        PORT_FILE: filePath,
      })
      expect(cfg.env.port).toBe(8080)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('embeds a customSection', () => {
    const Composed = defineConfig({
      basic: {
        port: configField({
          envName: 'PORT',
          description: 'port',
          type: z.coerce.number(),
          default: 3001,
        }),
      },
      custom: customSection({
        load: (env) => ({ raw: env['CUSTOM_X'] ?? 'fallback' }),
        describe: () => [
          {
            path: ['raw'],
            envName: 'CUSTOM_X',
            kind: 'config' as const,
            description: 'custom value',
            hasDefault: true,
            defaultRepr: '"fallback"',
            typeRepr: 'string',
          },
        ],
      }),
    })
    const cfg = Composed.load({ CUSTOM_X: 'set' })
    expect(cfg.custom.raw).toBe('set')
    const docs = Composed.describe()
    const customDoc = docs.find((d) => d.envName === 'CUSTOM_X')
    expect(customDoc?.path).toEqual(['custom', 'raw'])
  })
})

describe('zBooleanString', () => {
  it('parses truthy strings', () => {
    expect(zBooleanString.parse('true')).toBe(true)
    expect(zBooleanString.parse('1')).toBe(true)
    expect(zBooleanString.parse('YES')).toBe(true)
  })

  it('parses falsy strings', () => {
    expect(zBooleanString.parse('false')).toBe(false)
    expect(zBooleanString.parse('0')).toBe(false)
    expect(zBooleanString.parse('No')).toBe(false)
  })

  it('rejects garbage', () => {
    expect(() => zBooleanString.parse('maybe')).toThrow()
  })
})

describe('zCsv', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(zCsv.parse('a, b ,,c')).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for empty string', () => {
    expect(zCsv.parse('')).toEqual([])
  })
})
