#!/usr/bin/env bun
/**
 * Best-effort purge of existing FP32 embeddings in Garage before the FP16 worker
 * rollout. Cached embeddings are content-addressed and recomputable; there is no
 * in-band dtype marker, so the safe path is to drop the cache and let embedding
 * jobs re-run on next predict request. One-time ops step.
 *
 * DEFAULT BEHAVIOR IS DRY-RUN. Destructive action requires the explicit --execute flag.
 * Passing both --dry-run and --execute is an error (exits non-zero).
 *
 * Usage:
 *   bun scripts/purge-embedding-cache.ts                 # lists only (dry-run; default)
 *   bun scripts/purge-embedding-cache.ts --dry-run       # same as default (explicit alias)
 *   bun scripts/purge-embedding-cache.ts --execute       # deletes objects for real
 *   bun scripts/purge-embedding-cache.ts --execute --prefix <key-prefix>
 *
 * Requires the same env as the workers: GARAGE_ENDPOINT, GARAGE_ACCESS_KEY_ID,
 * GARAGE_SECRET_ACCESS_KEY, GARAGE_BUCKET (see @protifer/shared/storage).
 */

import pino from 'pino'
import {
  createS3ObjectStore,
  defaultPinoOptions,
  readConfig,
  readSecret,
} from '@protifer/shared'
import type { ObjectStore, Logger } from '@protifer/shared'

const DEFAULT_PREFIX = readConfig('EMBEDDING_PREFIX') ?? 'emb/'

function requireEnv(name: string): string {
  const v = readConfig(name)
  if (!v) {
    throw new Error(`${name} is required to purge the embedding cache`)
  }
  return v
}

function buildStoreFromEnv(): ObjectStore {
  return createS3ObjectStore({
    config: {
      endpoint: requireEnv('GARAGE_ENDPOINT'),
      region: requireEnv('GARAGE_REGION'),
      bucket: requireEnv('GARAGE_BUCKET'),
      accessKeyId: readSecret('GARAGE_ACCESS_KEY_ID'),
      secretAccessKey: readSecret('GARAGE_SECRET_ACCESS_KEY'),
    },
  })
}

export interface PurgeOptions {
  dryRun: boolean
  prefix: string
}

export interface PurgeResult {
  listed: number
  deleted: number
}

export async function purgeEmbeddingCache(
  store: ObjectStore,
  logger: Logger,
  opts: PurgeOptions,
): Promise<PurgeResult> {
  let listed = 0
  let deleted = 0
  for await (const key of store.listKeys(opts.prefix)) {
    listed += 1
    logger.info({ key, dryRun: opts.dryRun }, 'embedding cache entry')
    if (!opts.dryRun) {
      await store.delete(key)
      deleted += 1
    }
  }
  logger.info({ listed, deleted, dryRun: opts.dryRun }, 'purge complete')
  return { listed, deleted }
}

export function parseArgs(argv: readonly string[]): {
  dryRun: boolean
  prefix: string
  conflict: boolean
} {
  const hasDryRun = argv.includes('--dry-run')
  const hasExecute = argv.includes('--execute')
  const conflict = hasDryRun && hasExecute
  const prefixIdx = argv.indexOf('--prefix')
  const prefix =
    prefixIdx >= 0 ? (argv[prefixIdx + 1] ?? DEFAULT_PREFIX) : DEFAULT_PREFIX
  const dryRun = !hasExecute
  return { dryRun, prefix, conflict }
}

if (import.meta.main) {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.conflict) {
    console.error(
      'ERROR: --dry-run and --execute are mutually exclusive. Choose one.',
    )
    process.exit(2)
  }
  if (parsed.dryRun) {
    console.log('[dry-run] Listing only. Pass --execute to perform deletions.')
  }

  const store = buildStoreFromEnv()
  const logger = pino({
    name: 'purge-embedding-cache',
    ...defaultPinoOptions(),
  })
  purgeEmbeddingCache(store, logger, {
    dryRun: parsed.dryRun,
    prefix: parsed.prefix,
  })
    .then(({ listed, deleted }) => {
      console.log(`listed=${listed} deleted=${deleted} dryRun=${parsed.dryRun}`)
      process.exit(0)
    })
    .catch((err: unknown) => {
      console.error('purge failed:', err)
      process.exit(1)
    })
}
