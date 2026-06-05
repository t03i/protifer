import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

import { createFilesystemObjectStore } from './storage-fs.ts'
export { createFilesystemObjectStore } from './storage-fs.ts'

export interface S3ObjectStoreConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export interface ObjectStore {
  exists(key: string): Promise<boolean>
  get(key: string): Promise<Buffer>
  put(key: string, body: Buffer | string, contentType?: string): Promise<void>
  listKeys(prefix: string): AsyncIterable<string>
  delete(key: string): Promise<void>
}

export interface CreateS3ObjectStoreOptions {
  client?: S3Client
  config: S3ObjectStoreConfig
}

export function createS3ObjectStore(
  opts: CreateS3ObjectStoreOptions,
): ObjectStore {
  const { config } = opts
  const bucket = config.bucket
  const s3 =
    opts.client ??
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    })
  return {
    async exists(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return true
      } catch {
        return false
      }
    },
    async get(key) {
      const resp = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )
      if (!resp.Body) throw new Error(`Empty body for key: ${key}`)
      return Buffer.from(await resp.Body.transformToByteArray())
    },
    async put(key, body, contentType = 'application/octet-stream') {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      )
    },
    async *listKeys(prefix) {
      let continuationToken: string | undefined
      for (;;) {
        const resp = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        )
        for (const obj of resp.Contents ?? []) {
          if (obj.Key) yield obj.Key
        }
        if (!resp.IsTruncated) return
        continuationToken = resp.NextContinuationToken
      }
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}

export type ObjectStoreOptions =
  | { driver: 'filesystem'; path: string }
  | { driver: 's3'; config: S3ObjectStoreConfig }

export function createObjectStore(opts: ObjectStoreOptions): ObjectStore {
  return opts.driver === 'filesystem'
    ? createFilesystemObjectStore({ root: opts.path })
    : createS3ObjectStore({ config: opts.config })
}

export function makeInMemoryStore(initial?: Map<string, Buffer>): ObjectStore {
  const data = new Map<string, Buffer>(initial)
  return {
    exists: (key) => Promise.resolve(data.has(key)),
    get: (key) => {
      const v = data.get(key)
      if (!v)
        throw Object.assign(new Error(`Not found: ${key}`), {
          $metadata: { httpStatusCode: 404 },
        })
      return Promise.resolve(v)
    },
    put: (key, body) => {
      data.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body))
      return Promise.resolve()
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    listKeys: async function* (prefix) {
      for (const key of data.keys()) {
        if (key.startsWith(prefix)) yield key
      }
    },
    delete: (key) => {
      data.delete(key)
      return Promise.resolve()
    },
  }
}
