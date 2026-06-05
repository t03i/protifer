import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  readSecret,
  readSecretOptional,
  MissingSecretError,
  SecretReadError,
} from './secrets.ts'

describe('readSecret', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'secrets-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('reads from FILE first when both FILE and env are set', () => {
    const filePath = path.join(tempDir, 'pw')
    writeFileSync(filePath, 'from-file')
    const env = {
      POSTGRES_PASSWORD_FILE: filePath,
      POSTGRES_PASSWORD: 'from-env',
    }
    expect(readSecret('POSTGRES_PASSWORD', env)).toBe('from-file')
  })

  it('falls back to env when FILE is unset', () => {
    const env = { POSTGRES_PASSWORD: 'from-env' }
    expect(readSecret('POSTGRES_PASSWORD', env)).toBe('from-env')
  })

  it('trims trailing whitespace from file content', () => {
    const filePath = path.join(tempDir, 'pw')
    writeFileSync(filePath, 'value\n\n  ')
    const env = { TOKEN_FILE: filePath }
    expect(readSecret('TOKEN', env)).toBe('value')
  })

  it('preserves leading whitespace in file content', () => {
    const filePath = path.join(tempDir, 'pw')
    writeFileSync(filePath, '  prefixed-value\n')
    const env = { TOKEN_FILE: filePath }
    expect(readSecret('TOKEN', env)).toBe('  prefixed-value')
  })

  it('throws SecretReadError when FILE points to a missing path', () => {
    const env = { TOKEN_FILE: path.join(tempDir, 'no-such-file') }
    expect(() => readSecret('TOKEN', env)).toThrow(SecretReadError)
  })

  it('throws MissingSecretError when neither source is set', () => {
    expect(() => readSecret('TOKEN', {})).toThrow(MissingSecretError)
  })

  it('throws MissingSecretError when env value is empty string', () => {
    expect(() => readSecret('TOKEN', { TOKEN: '' })).toThrow(MissingSecretError)
  })

  it('treats empty FILE path as unset and falls back to env', () => {
    const env = { TOKEN_FILE: '', TOKEN: 'from-env' }
    expect(readSecret('TOKEN', env)).toBe('from-env')
  })
})

describe('readSecretOptional', () => {
  it('returns undefined when neither source is set', () => {
    expect(readSecretOptional('TOKEN', {})).toBeUndefined()
  })

  it('returns the value when env is set', () => {
    expect(readSecretOptional('TOKEN', { TOKEN: 'x' })).toBe('x')
  })

  it('rethrows SecretReadError when FILE is unreadable', () => {
    const env = { TOKEN_FILE: '/no/such/path/here' }
    expect(() => readSecretOptional('TOKEN', env)).toThrow(SecretReadError)
  })
})
