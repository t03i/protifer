import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFilesystemObjectStore } from './storage-fs.ts'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protifer-fs-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('createFilesystemObjectStore — round-trip', () => {
  it('put() then get() returns exact bytes', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('k', Buffer.from([1, 2, 3]))
    const out = await store.get('k')
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(out.equals(Buffer.from([1, 2, 3]))).toBe(true)
  })

  it('coerces string bodies to Buffer', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('k', 'hello')
    const out = await store.get('k')
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(out.toString('utf-8')).toBe('hello')
  })

  it('contentType argument is accepted and ignored', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('k', Buffer.from([9]), 'application/octet-stream')
    const out = await store.get('k')
    expect(out.equals(Buffer.from([9]))).toBe(true)
  })

  it('exists() reflects put and delete', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    expect(await store.exists('k')).toBe(false)
    await store.put('k', 'x')
    expect(await store.exists('k')).toBe(true)
    await store.delete('k')
    expect(await store.exists('k')).toBe(false)
  })
})

describe('createFilesystemObjectStore — error shape', () => {
  it('get() on missing key throws an S3-shaped 404 error', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    let caught: unknown
    try {
      await store.get('absent')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('absent')
    expect(
      (caught as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode,
    ).toBe(404)
  })

  it('delete() of missing key is a no-op', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await expect(store.delete('nonexistent')).resolves.toBeUndefined()
  })
})

describe('createFilesystemObjectStore — listing', () => {
  it('listKeys() filters by prefix', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('users/1', 'a')
    await store.put('users/2', 'b')
    await store.put('jobs/1', 'c')
    const out: string[] = []
    for await (const k of store.listKeys('users/')) out.push(k)
    expect(out.sort()).toEqual(['users/1', 'users/2'])
  })

  it('listKeys() with empty prefix yields all keys', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('a', '1')
    await store.put('b', '2')
    const out: string[] = []
    for await (const k of store.listKeys('')) out.push(k)
    expect(out.sort()).toEqual(['a', 'b'])
  })

  it('listKeys() handles nested directories', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('a/b/c', 'deep')
    await store.put('a/d', 'shallow')
    const out: string[] = []
    for await (const k of store.listKeys('a/')) out.push(k)
    expect(out.sort()).toEqual(['a/b/c', 'a/d'])
  })

  it('listKeys() uses POSIX separators on all platforms', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('x/y/z', 'v')
    const out: string[] = []
    for await (const k of store.listKeys('')) out.push(k)
    expect(out).toEqual(['x/y/z'])
  })

  it('listKeys() yields nothing when root does not exist', async () => {
    const store = createFilesystemObjectStore({
      root: path.join(tmpDir, 'nonexistent'),
    })
    const out: string[] = []
    for await (const k of store.listKeys('')) out.push(k)
    expect(out).toEqual([])
  })
})

describe('createFilesystemObjectStore — atomic put', () => {
  it('does not leave temp files after a successful put', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('file', Buffer.from('data'))
    const entries = await fs.readdir(tmpDir)
    expect(entries).toEqual(['file'])
  })

  it('overwrites an existing key atomically', async () => {
    const store = createFilesystemObjectStore({ root: tmpDir })
    await store.put('k', 'first')
    await store.put('k', 'second')
    const out = await store.get('k')
    expect(out.toString('utf-8')).toBe('second')
  })
})
