import { makeInMemoryStore } from '@protifer/shared'
import type { Logger } from '@protifer/shared'
import { describe, it, expect, vi } from 'vitest'

import { purgeEmbeddingCache, parseArgs } from './purge-embedding-cache.ts'

function seed(pairs: [string, Buffer][]) {
  return makeInMemoryStore(new Map(pairs))
}

const noopLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => noopLogger),
} as unknown as Logger

describe('purgeEmbeddingCache', () => {
  it('dry-run lists but does not delete (DEFAULT mode)', async () => {
    const store = seed([
      ['emb/a', Buffer.from('1')],
      ['emb/b', Buffer.from('2')],
      ['emb/c', Buffer.from('3')],
    ])
    const spy = vi.spyOn(store, 'delete')
    const r = await purgeEmbeddingCache(store, noopLogger, {
      dryRun: true,
      prefix: 'emb/',
    })
    expect(r.listed).toBe(3)
    expect(r.deleted).toBe(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('execute mode deletes every key under the prefix', async () => {
    const store = seed([
      ['emb/a', Buffer.from('1')],
      ['emb/b', Buffer.from('2')],
    ])
    const r = await purgeEmbeddingCache(store, noopLogger, {
      dryRun: false,
      prefix: 'emb/',
    })
    expect(r.listed).toBe(2)
    expect(r.deleted).toBe(2)
    expect(await store.exists('emb/a')).toBe(false)
    expect(await store.exists('emb/b')).toBe(false)
  })

  it('handles empty prefix', async () => {
    const store = seed([])
    const r = await purgeEmbeddingCache(store, noopLogger, {
      dryRun: false,
      prefix: 'emb/',
    })
    expect(r.listed).toBe(0)
    expect(r.deleted).toBe(0)
  })

  it('leaves keys outside the prefix untouched', async () => {
    const store = seed([
      ['emb/a', Buffer.from('1')],
      ['pred/b', Buffer.from('2')],
    ])
    const r = await purgeEmbeddingCache(store, noopLogger, {
      dryRun: false,
      prefix: 'emb/',
    })
    expect(r.listed).toBe(1)
    expect(r.deleted).toBe(1)
    await expect(store.get('pred/b')).resolves.toBeInstanceOf(Buffer)
  })
})

describe('parseArgs', () => {
  it('no flags → dry-run mode (destructive action requires --execute)', () => {
    const { dryRun, conflict } = parseArgs([])
    expect(dryRun).toBe(true)
    expect(conflict).toBe(false)
  })

  it('--dry-run alone → dry-run', () => {
    const { dryRun, conflict } = parseArgs(['--dry-run'])
    expect(dryRun).toBe(true)
    expect(conflict).toBe(false)
  })

  it('--execute alone → dryRun=false', () => {
    const { dryRun, conflict } = parseArgs(['--execute'])
    expect(dryRun).toBe(false)
    expect(conflict).toBe(false)
  })

  it('--dry-run AND --execute → conflict=true', () => {
    const { conflict } = parseArgs(['--dry-run', '--execute'])
    expect(conflict).toBe(true)
  })

  it('--prefix picks up custom prefix value', () => {
    const { prefix } = parseArgs(['--prefix', 'custom/'])
    expect(prefix).toBe('custom/')
  })
})
