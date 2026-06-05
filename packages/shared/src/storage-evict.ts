import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface EvictEntry {
  key: string
  size: number
  lastAccessMs: number
}

export function selectEvictions(
  entries: EvictEntry[],
  maxBytes: number,
): string[] {
  if (maxBytes <= 0) return []

  const total = entries.reduce((sum, e) => sum + e.size, 0)
  if (total <= maxBytes) return []

  const sorted = entries
    .slice()
    .sort(
      (a, b) => a.lastAccessMs - b.lastAccessMs || a.key.localeCompare(b.key),
    )

  const toEvict: string[] = []
  let remaining = total
  for (const entry of sorted) {
    if (remaining <= maxBytes) break
    toEvict.push(entry.key)
    remaining -= entry.size
  }
  return toEvict
}

// `totalBytesBefore` is 0 on the disabled path (maxBytes <= 0) since the walk is skipped.
export async function sweepFilesystemBudget(opts: {
  root: string
  maxBytes: number
  delete: (key: string) => Promise<void>
}): Promise<{
  evicted: string[]
  freedBytes: number
  totalBytesBefore: number
}> {
  if (opts.maxBytes <= 0) {
    return { evicted: [], freedBytes: 0, totalBytesBefore: 0 }
  }

  const entries: EvictEntry[] = []

  async function walk(dir: string): Promise<void> {
    let items: { name: string; isDirectory(): boolean }[]
    try {
      items = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    for (const item of items) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) {
        await walk(full)
      } else {
        const st = await fs.stat(full)
        const key = path.relative(opts.root, full).split(path.sep).join('/')
        entries.push({ key, size: st.size, lastAccessMs: st.atimeMs })
      }
    }
  }

  await walk(opts.root)

  const totalBytesBefore = entries.reduce((sum, e) => sum + e.size, 0)
  const keys = selectEvictions(entries, opts.maxBytes)
  const sizeMap = new Map(entries.map((e) => [e.key, e.size]))

  for (const key of keys) {
    await opts.delete(key)
  }

  const freedBytes = keys.reduce((sum, k) => sum + (sizeMap.get(k) ?? 0), 0)
  return { evicted: keys, freedBytes, totalBytesBefore }
}
