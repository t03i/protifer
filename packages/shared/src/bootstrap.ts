import { ConfigValidationError } from './config.ts'
import { createObjectStore } from './storage.ts'
import type { ObjectStore } from './storage.ts'

/**
 * Runs a service's `loadConfig`, exiting the process with a readable message on
 * a `ConfigValidationError` (the only expected fail-fast path). Other errors
 * rethrow. Shared by both workers' boot sequences.
 */
export function loadConfigOrExit<T>(loadConfig: () => T): T {
  try {
    return loadConfig()
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(`\nFatal: ${err.message}\n`)
      process.exit(1)
    }
    throw err
  }
}

/** Flat storage config shape produced by the per-service config schemas. */
export interface ObjectStoreConfigInput {
  driver: 's3' | 'filesystem'
  path: string
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Builds an `ObjectStore` from a flat storage config section, mapping the
 * driver discriminant to `createObjectStore`'s tagged union. Shared by both
 * workers so the driver-switch lives in one place.
 */
export function createObjectStoreFromConfig(
  storage: ObjectStoreConfigInput,
): ObjectStore {
  return createObjectStore(
    storage.driver === 'filesystem'
      ? { driver: 'filesystem', path: storage.path }
      : {
          driver: 's3',
          config: {
            endpoint: storage.endpoint,
            region: storage.region,
            bucket: storage.bucket,
            accessKeyId: storage.accessKeyId,
            secretAccessKey: storage.secretAccessKey,
          },
        },
  )
}
