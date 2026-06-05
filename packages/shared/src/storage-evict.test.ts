import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { EvictEntry } from './storage-evict.ts'
import { selectEvictions, sweepFilesystemBudget } from './storage-evict.ts'
import { createFilesystemObjectStore } from './storage-fs.ts'

describe('selectEvictions', () => {
  it('returns [] when total <= budget', () => {
    const entries: EvictEntry[] = [
      { key: 'a', size: 100, lastAccessMs: 1000 },
      { key: 'b', size: 200, lastAccessMs: 2000 },
    ]
    expect(selectEvictions(entries, 300)).toEqual([])
    expect(selectEvictions(entries, 400)).toEqual([])
  })

  it('returns [] when maxBytes <= 0', () => {
    const entries: EvictEntry[] = [{ key: 'a', size: 100, lastAccessMs: 1000 }]
    expect(selectEvictions(entries, 0)).toEqual([])
    expect(selectEvictions(entries, -1)).toEqual([])
  })

  it('evicts coldest-first until total <= budget', () => {
    const entries: EvictEntry[] = [
      { key: 'warm', size: 100, lastAccessMs: 3000 },
      { key: 'cold', size: 100, lastAccessMs: 1000 },
      { key: 'medium', size: 100, lastAccessMs: 2000 },
    ]
    const result = selectEvictions(entries, 150)
    expect(result).toEqual(['cold', 'medium'])
  })

  it('stops as soon as remaining <= budget', () => {
    const entries: EvictEntry[] = [
      { key: 'a', size: 50, lastAccessMs: 1000 },
      { key: 'b', size: 50, lastAccessMs: 2000 },
      { key: 'c', size: 50, lastAccessMs: 3000 },
    ]
    // Stops once remaining equals budget exactly (boundary is inclusive).
    const result = selectEvictions(entries, 100)
    expect(result).toEqual(['a'])
  })

  it('evicts everything when budget is tiny (1 byte)', () => {
    const entries: EvictEntry[] = [
      { key: 'x', size: 10, lastAccessMs: 100 },
      { key: 'y', size: 10, lastAccessMs: 200 },
    ]
    const result = selectEvictions(entries, 1)
    expect(result).toEqual(['x', 'y'])
  })

  it('handles empty entries', () => {
    expect(selectEvictions([], 1000)).toEqual([])
  })

  it('deterministic tie-breaking: sorts by key ascending when lastAccessMs is equal', () => {
    const entries: EvictEntry[] = [
      { key: 'b', size: 100, lastAccessMs: 1000 },
      { key: 'a', size: 100, lastAccessMs: 1000 },
    ]
    // Equal lastAccessMs → tie broken by key ascending, so 'a' goes first.
    const result = selectEvictions(entries, 150)
    expect(result).toEqual(['a'])
  })

  it('returns all entries when none fit within budget', () => {
    const entries: EvictEntry[] = [
      { key: 'a', size: 500, lastAccessMs: 1000 },
      { key: 'b', size: 500, lastAccessMs: 2000 },
    ]
    const result = selectEvictions(entries, 50)
    expect(result).toEqual(['a', 'b'])
  })
})

describe('sweepFilesystemBudget', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protifer-evict-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeFile(
    rel: string,
    content: string,
    atimeSec: number,
  ): Promise<void> {
    const full = path.join(tmpDir, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content)
    await fs.utimes(full, atimeSec, atimeSec)
  }

  it('no-op when maxBytes <= 0', async () => {
    await writeFile('a', 'hello', 1000)
    const deleted: string[] = []
    const result = await sweepFilesystemBudget({
      root: tmpDir,
      maxBytes: 0,
      delete: (k) => {
        deleted.push(k)
        return Promise.resolve()
      },
    })
    expect(result.evicted).toEqual([])
    expect(result.freedBytes).toBe(0)
    expect(deleted).toEqual([])
  })

  it('no-op when total <= budget', async () => {
    await writeFile('a', 'hi', 1000)
    const deleted: string[] = []
    const result = await sweepFilesystemBudget({
      root: tmpDir,
      maxBytes: 10_000,
      delete: (k) => {
        deleted.push(k)
        return Promise.resolve()
      },
    })
    expect(result.evicted).toEqual([])
    expect(result.freedBytes).toBe(0)
    expect(deleted).toEqual([])
  })

  it('evicts coldest files, reports freedBytes and totalBytesBefore', async () => {
    await writeFile('cold', 'AAAA', 1000)
    await writeFile('warm', 'BBBBBBBB', 3000)
    await writeFile('hot', 'CCCC', 5000)

    const deleted: string[] = []
    const result = await sweepFilesystemBudget({
      root: tmpDir,
      maxBytes: 8, // total=16; evicts coldest (cold=4, warm=8) until ≤8
      delete: async (k) => {
        deleted.push(k)
        await fs.unlink(path.join(tmpDir, k))
      },
    })

    expect(deleted.sort()).toEqual(['cold', 'warm'])
    expect(result.evicted.sort()).toEqual(['cold', 'warm'])
    expect(result.freedBytes).toBe(12)
    expect(result.totalBytesBefore).toBe(16)

    const remaining = await fs.readdir(tmpDir)
    expect(remaining).toEqual(['hot'])
  })

  it('handles nested key paths', async () => {
    await writeFile('emb/old', 'AAAA', 1000)
    await writeFile('pred/new', 'BB', 5000)

    const deleted: string[] = []
    const result = await sweepFilesystemBudget({
      root: tmpDir,
      maxBytes: 2,
      delete: async (k) => {
        deleted.push(k)
        await fs.unlink(path.join(tmpDir, k))
      },
    })

    expect(deleted).toEqual(['emb/old'])
    expect(result.evicted).toEqual(['emb/old'])
  })

  it('works on empty root dir', async () => {
    const result = await sweepFilesystemBudget({
      root: tmpDir,
      maxBytes: 100,
      delete: async () => {},
    })
    expect(result.evicted).toEqual([])
    expect(result.freedBytes).toBe(0)
    expect(result.totalBytesBefore).toBe(0)
  })
})

describe('lossless-in-effect: eviction is recoverable via recompute', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protifer-lossless-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('evicted blob can be recomputed and retrieved identically', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    const key = 'emb/abc123'
    const originalData = Buffer.from('embedding-payload-bytes')

    await store.put(key, originalData)
    expect(await store.exists(key)).toBe(true)

    await sweepFilesystemBudget({
      root: tmpDir,
      maxBytes: 1,
      delete: (k) => store.delete(k),
    })

    expect(await store.exists(key)).toBe(false)

    const recomputed = Buffer.from('embedding-payload-bytes')
    await store.put(key, recomputed)

    const retrieved = await store.get(key)
    expect(retrieved.equals(originalData)).toBe(true)
  })
})
