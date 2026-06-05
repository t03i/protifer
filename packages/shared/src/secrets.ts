import { readFileSync } from 'node:fs'

export class MissingSecretError extends Error {
  readonly secretName: string

  constructor(name: string) {
    super(
      `Missing required secret: ${name}. ` +
        `Set ${name}_FILE to a readable file path, or ${name} as an environment variable.`,
    )
    this.name = 'MissingSecretError'
    this.secretName = name
  }
}

export class SecretReadError extends Error {
  constructor(name: string, path: string, cause: unknown) {
    super(
      `Failed to read secret ${name} from ${path}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    )
    this.name = 'SecretReadError'
  }
}

/**
 * Reads a secret value with file-wins precedence.
 *
 * 1. If `${name}_FILE` is set, read the file (trim trailing whitespace).
 * 2. Else if `${name}` is set, return the env value.
 * 3. Else throw `MissingSecretError`.
 *
 * File-wins matches Docker/Postgres/Redis/k8s convention. The secret pipeline
 * (Swarm Raft, k8s API, Vault) is the more-trusted channel; env vars leak
 * into `docker inspect`, `/proc/<pid>/environ`, child processes, and crash
 * dumps.
 */
export function readSecret(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const filePath = env[`${name}_FILE`]
  if (filePath !== undefined && filePath !== '') {
    try {
      return readFileSync(filePath, 'utf8').replace(/\s+$/, '')
    } catch (err) {
      throw new SecretReadError(name, filePath, err)
    }
  }
  const envValue = env[name]
  if (envValue !== undefined && envValue !== '') return envValue
  throw new MissingSecretError(name)
}

/**
 * Like `readSecret` but returns `undefined` if neither source is set.
 * Used by the field loader to honour declared defaults.
 */
export function readSecretOptional(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  try {
    return readSecret(name, env)
  } catch (err) {
    if (err instanceof MissingSecretError) return undefined
    throw err
  }
}
