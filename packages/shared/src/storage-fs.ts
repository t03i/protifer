import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { ObjectStore } from './storage.ts'

export function createFilesystemObjectStore(opts: {
  root: string
}): ObjectStore {
  const { root } = opts

  function absPath(key: string): string {
    return path.join(root, key)
  }

  function notFound(key: string): never {
    throw Object.assign(new Error(`Not found: ${key}`), {
      $metadata: { httpStatusCode: 404 },
    })
  }

  return {
    async exists(key) {
      try {
        await fs.stat(absPath(key))
        return true
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw err
      }
    },

    async get(key) {
      try {
        return await fs.readFile(absPath(key))
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') notFound(key)
        throw err
      }
    },

    async put(key, body) {
      const target = absPath(key)
      const dir = path.dirname(target)
      await fs.mkdir(dir, { recursive: true })
      const tmp = `${target}.tmp.${randomBytes(8).toString('hex')}`
      try {
        await fs.writeFile(tmp, body)
        await fs.rename(tmp, target)
      } catch (err) {
        await fs.unlink(tmp).catch(() => undefined)
        throw err
      }
    },

    async *listKeys(prefix) {
      async function* walk(dir: string): AsyncIterable<string> {
        let entries: { name: string; isDirectory(): boolean }[]
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
          throw err
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            yield* walk(full)
          } else {
            const key = path.relative(root, full).split(path.sep).join('/')
            if (key.startsWith(prefix)) yield key
          }
        }
      }
      yield* walk(root)
    },

    async delete(key) {
      try {
        await fs.unlink(absPath(key))
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    },
  }
}
