import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import {
  createObjectStore,
  createS3ObjectStore,
  makeInMemoryStore,
} from './storage.ts'
import type { S3ObjectStoreConfig } from './storage.ts'

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  }
})

type SendFn = (cmd: unknown) => Promise<unknown>
type FakeClient = { send: Mock<SendFn> }
const fakeClient = (): FakeClient => ({ send: vi.fn<SendFn>() })
const asS3 = (c: FakeClient) => c as unknown as S3Client

const TEST_BUCKET = 'test-bucket'
const TEST_CONFIG: S3ObjectStoreConfig = {
  endpoint: 'http://localhost:3900',
  region: 'garage',
  bucket: TEST_BUCKET,
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
}

describe('createS3ObjectStore — client construction', () => {
  beforeEach(() => {
    vi.mocked(S3Client).mockClear()
  })
  afterEach(() => {
    vi.mocked(S3Client).mockClear()
  })

  it('forwards the supplied endpoint, region, and credentials', () => {
    createS3ObjectStore({
      config: {
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'unused-here',
        accessKeyId: 'AKIA-test',
        secretAccessKey: 'secret-test',
      },
    })
    expect(vi.mocked(S3Client).mock.calls[0]?.[0]).toEqual({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIA-test',
        secretAccessKey: 'secret-test',
      },
      forcePathStyle: true,
    })
  })
})

describe('createS3ObjectStore — command dispatch', () => {
  it('exists() sends HeadObjectCommand with the right input', async () => {
    const client = fakeClient()
    client.send.mockResolvedValueOnce({})
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    await store.exists('some/key')
    expect(client.send).toHaveBeenCalledTimes(1)
    const cmd = client.send.mock.calls[0]?.[0]
    expect(cmd).toBeInstanceOf(HeadObjectCommand)
    expect((cmd as HeadObjectCommand).input).toEqual({
      Bucket: TEST_BUCKET,
      Key: 'some/key',
    })
  })

  it('get() returns a Buffer of the body bytes and dispatches GetObjectCommand', async () => {
    const client = fakeClient()
    const bytes = new Uint8Array([7, 8, 9])
    client.send.mockResolvedValueOnce({
      Body: { transformToByteArray: () => Promise.resolve(bytes) },
    })
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    const result = await store.get('some/key')
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.equals(Buffer.from([7, 8, 9]))).toBe(true)
    const cmd = client.send.mock.calls[0]?.[0]
    expect(cmd).toBeInstanceOf(GetObjectCommand)
    expect((cmd as GetObjectCommand).input).toEqual({
      Bucket: TEST_BUCKET,
      Key: 'some/key',
    })
  })

  it('put() defaults ContentType to application/octet-stream', async () => {
    const client = fakeClient()
    client.send.mockResolvedValueOnce({})
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    const body = Buffer.from('payload')
    await store.put('k', body)
    const cmd = client.send.mock.calls[0]?.[0]
    expect(cmd).toBeInstanceOf(PutObjectCommand)
    expect((cmd as PutObjectCommand).input).toEqual({
      Bucket: TEST_BUCKET,
      Key: 'k',
      Body: body,
      ContentType: 'application/octet-stream',
    })
  })

  it('put() honors a caller-provided ContentType', async () => {
    const client = fakeClient()
    client.send.mockResolvedValueOnce({})
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    await store.put('k', '{"x":1}', 'application/json')
    const cmd = client.send.mock.calls[0]?.[0] as PutObjectCommand
    expect(cmd.input.ContentType).toBe('application/json')
  })

  it('delete() sends DeleteObjectCommand', async () => {
    const client = fakeClient()
    client.send.mockResolvedValueOnce({})
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    await store.delete('some/key')
    expect(client.send).toHaveBeenCalledTimes(1)
    const cmd = client.send.mock.calls[0]?.[0]
    expect(cmd).toBeInstanceOf(DeleteObjectCommand)
    expect((cmd as DeleteObjectCommand).input).toEqual({
      Bucket: TEST_BUCKET,
      Key: 'some/key',
    })
  })
})

describe('createS3ObjectStore — error handling', () => {
  it('exists() returns false on a 404-shaped error', async () => {
    const client = fakeClient()
    client.send.mockRejectedValueOnce(
      Object.assign(new Error('NotFound'), {
        $metadata: { httpStatusCode: 404 },
      }),
    )
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    await expect(store.exists('k')).resolves.toBe(false)
  })

  it('exists() returns false on arbitrary errors (does not throw)', async () => {
    const client = fakeClient()
    client.send.mockRejectedValueOnce(new Error('boom'))
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    await expect(store.exists('k')).resolves.toBe(false)
  })

  it('get() rejects with the key in the error message when Body is undefined', async () => {
    const client = fakeClient()
    client.send.mockResolvedValueOnce({ Body: undefined })
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    await expect(store.get('missing')).rejects.toThrow(/missing/)
  })
})

describe('createS3ObjectStore.listKeys — pagination', () => {
  it('yields all keys from a single non-truncated page', async () => {
    const client = fakeClient()
    client.send.mockResolvedValueOnce({
      Contents: [{ Key: 'a' }, { Key: 'b' }],
      IsTruncated: false,
    })
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    const out: string[] = []
    for await (const k of store.listKeys('p/')) out.push(k)
    expect(out).toEqual(['a', 'b'])
    expect(client.send).toHaveBeenCalledTimes(1)
  })

  it('paginates via ContinuationToken until IsTruncated is false', async () => {
    const client = fakeClient()
    client.send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a' }],
        IsTruncated: true,
        NextContinuationToken: 't1',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'b' }],
        IsTruncated: false,
      })
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    const out: string[] = []
    for await (const k of store.listKeys('p/')) out.push(k)
    expect(out).toEqual(['a', 'b'])
    expect(client.send).toHaveBeenCalledTimes(2)
    const second = client.send.mock.calls[1]?.[0] as ListObjectsV2Command
    expect(second.input.ContinuationToken).toBe('t1')
  })

  it('skips entries that have no Key', async () => {
    const client = fakeClient()
    client.send.mockResolvedValueOnce({
      Contents: [{ Key: 'a' }, {}],
      IsTruncated: false,
    })
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    const out: string[] = []
    for await (const k of store.listKeys('p/')) out.push(k)
    expect(out).toEqual(['a'])
  })

  it('forwards the caller prefix and bucket on the first page', async () => {
    const client = fakeClient()
    client.send.mockResolvedValueOnce({ Contents: [], IsTruncated: false })
    const store = createS3ObjectStore({
      client: asS3(client),
      config: TEST_CONFIG,
    })
    const out: string[] = []
    for await (const k of store.listKeys('users/123/')) out.push(k)
    expect(out).toEqual([])
    const cmd = client.send.mock.calls[0]?.[0] as ListObjectsV2Command
    expect(cmd).toBeInstanceOf(ListObjectsV2Command)
    expect(cmd.input.Prefix).toBe('users/123/')
    expect(cmd.input.Bucket).toBe(TEST_BUCKET)
  })
})

describe('makeInMemoryStore — round-trip', () => {
  it('put() then get() returns the same Buffer bytes', async () => {
    const store = makeInMemoryStore()
    await store.put('k', Buffer.from([1, 2, 3]))
    const out = await store.get('k')
    expect(out.equals(Buffer.from([1, 2, 3]))).toBe(true)
  })

  it('exists() reflects put and delete', async () => {
    const store = makeInMemoryStore()
    await store.put('k', 'x')
    expect(await store.exists('k')).toBe(true)
    await store.delete('k')
    expect(await store.exists('k')).toBe(false)
  })

  it('coerces string bodies to Buffer', async () => {
    const store = makeInMemoryStore()
    await store.put('k', 'hello')
    const out = await store.get('k')
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(out.toString('utf-8')).toBe('hello')
  })
})

describe('makeInMemoryStore — error shape and listing', () => {
  it('get() on missing key throws an S3-shaped 404 error', async () => {
    const store = makeInMemoryStore()
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

  it('listKeys() filters by prefix in insertion order', async () => {
    const store = makeInMemoryStore()
    await store.put('users/1', 'a')
    await store.put('users/2', 'b')
    await store.put('jobs/1', 'c')
    const out: string[] = []
    for await (const k of store.listKeys('users/')) out.push(k)
    expect(out).toEqual(['users/1', 'users/2'])
  })

  it('listKeys() with empty prefix yields all keys', async () => {
    const store = makeInMemoryStore()
    await store.put('a', '1')
    await store.put('b', '2')
    const out: string[] = []
    for await (const k of store.listKeys('')) out.push(k)
    expect(out).toEqual(['a', 'b'])
  })
})

describe('makeInMemoryStore — initial seed', () => {
  it('reads values seeded via the initial Map', async () => {
    const store = makeInMemoryStore(new Map([['k', Buffer.from('v')]]))
    const out = await store.get('k')
    expect(out.equals(Buffer.from('v'))).toBe(true)
  })

  it('does not alias the seed map (post-construction mutations are ignored)', async () => {
    const seed = new Map([['k', Buffer.from('v')]])
    const store = makeInMemoryStore(seed)
    seed.set('k2', Buffer.from('v2'))
    expect(await store.exists('k2')).toBe(false)
  })
})

describe('createObjectStore — factory dispatch', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'protifer-factory-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('filesystem driver: put/get round-trips via the temp dir', async () => {
    const store = createObjectStore({ driver: 'filesystem', path: tmpDir })
    await store.put('x', Buffer.from([42]))
    const out = await store.get('x')
    expect(out.equals(Buffer.from([42]))).toBe(true)
  })

  it('filesystem driver: has all 5 ObjectStore methods', () => {
    const store = createObjectStore({ driver: 'filesystem', path: tmpDir })
    expect(typeof store.exists).toBe('function')
    expect(typeof store.get).toBe('function')
    expect(typeof store.put).toBe('function')
    expect(typeof store.listKeys).toBe('function')
    expect(typeof store.delete).toBe('function')
  })

  it('s3 driver: returns a store with all 5 ObjectStore methods', () => {
    const store = createObjectStore({
      driver: 's3',
      config: {
        endpoint: 'http://localhost:3900',
        region: 'garage',
        bucket: 'test',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
      },
    })
    expect(typeof store.exists).toBe('function')
    expect(typeof store.get).toBe('function')
    expect(typeof store.put).toBe('function')
    expect(typeof store.listKeys).toBe('function')
    expect(typeof store.delete).toBe('function')
  })
})
