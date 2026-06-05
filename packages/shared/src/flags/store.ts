import type { FlagOverrideRecord, FlagOverrideValue } from './types.ts'

export interface FlagOverrideStore {
  get<T = unknown>(name: string): Promise<FlagOverrideRecord<T> | null>
  set<T = unknown>(
    name: string,
    override: FlagOverrideValue<T>,
    updatedBy: string,
  ): Promise<FlagOverrideRecord<T>>
  delete(name: string): Promise<void>
  getAll(): Promise<Record<string, FlagOverrideRecord>>
}

const FLAG_KEY_PREFIX = 'flags:'

interface FlagOverrideRedis {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  del(key: string): Promise<number>
  scan(
    cursor: string | number,
    ...args: (string | number)[]
  ): Promise<[string, string[]]>
}

function parseRecord(raw: string): FlagOverrideRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('override' in parsed) ||
      !('updatedAt' in parsed) ||
      !('updatedBy' in parsed)
    ) {
      return null
    }
    return parsed as FlagOverrideRecord
  } catch {
    return null
  }
}

export class RedisFlagOverrideStore implements FlagOverrideStore {
  constructor(
    private readonly redis: FlagOverrideRedis,
    private readonly clock: { now(): number } = Date,
  ) {}

  async get<T>(name: string): Promise<FlagOverrideRecord<T> | null> {
    const raw = await this.redis.get(FLAG_KEY_PREFIX + name)
    if (raw === null) return null
    return parseRecord(raw) as FlagOverrideRecord<T> | null
  }

  async set<T>(
    name: string,
    override: FlagOverrideValue<T>,
    updatedBy: string,
  ): Promise<FlagOverrideRecord<T>> {
    const record: FlagOverrideRecord<T> = {
      override,
      updatedAt: new Date(this.clock.now()).toISOString(),
      updatedBy,
    }
    await this.redis.set(FLAG_KEY_PREFIX + name, JSON.stringify(record))
    return record
  }

  async delete(name: string): Promise<void> {
    await this.redis.del(FLAG_KEY_PREFIX + name)
  }

  async getAll(): Promise<Record<string, FlagOverrideRecord>> {
    const out: Record<string, FlagOverrideRecord> = {}
    let cursor = '0'
    do {
      const [next, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        `${FLAG_KEY_PREFIX}*`,
        'COUNT',
        100,
      )
      cursor = next
      const raws = await Promise.all(batch.map((k) => this.redis.get(k)))
      for (let i = 0; i < batch.length; i++) {
        const raw = raws[i]
        const key = batch[i]
        if (!raw || key === undefined) continue
        const rec = parseRecord(raw)
        if (rec) out[key.slice(FLAG_KEY_PREFIX.length)] = rec
      }
    } while (cursor !== '0')
    return out
  }
}

export class InMemoryFlagOverrideStore implements FlagOverrideStore {
  private readonly map = new Map<string, FlagOverrideRecord>()

  constructor(private readonly clock: { now(): number } = Date) {}

  get<T>(name: string): Promise<FlagOverrideRecord<T> | null> {
    return Promise.resolve(
      (this.map.get(name) as FlagOverrideRecord<T> | undefined) ?? null,
    )
  }

  set<T>(
    name: string,
    override: FlagOverrideValue<T>,
    updatedBy: string,
  ): Promise<FlagOverrideRecord<T>> {
    const record: FlagOverrideRecord<T> = {
      override,
      updatedAt: new Date(this.clock.now()).toISOString(),
      updatedBy,
    }
    this.map.set(name, record as FlagOverrideRecord)
    return Promise.resolve(record)
  }

  delete(name: string): Promise<void> {
    this.map.delete(name)
    return Promise.resolve()
  }

  getAll(): Promise<Record<string, FlagOverrideRecord>> {
    return Promise.resolve(Object.fromEntries(this.map.entries()))
  }
}

interface CacheEntry {
  value: FlagOverrideRecord | null
  expiresAt: number
}

export class CachedFlagOverrideStore implements FlagOverrideStore {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly inner: FlagOverrideStore,
    private readonly cacheTtlMs: number = 5_000,
    private readonly clock: { now(): number } = Date,
  ) {}

  async get<T>(name: string): Promise<FlagOverrideRecord<T> | null> {
    const now = this.clock.now()
    const entry = this.cache.get(name)
    if (entry && entry.expiresAt > now) {
      return entry.value as FlagOverrideRecord<T> | null
    }
    const value = await this.inner.get<T>(name)
    this.cache.set(name, {
      value: value as FlagOverrideRecord | null,
      expiresAt: now + this.cacheTtlMs,
    })
    return value
  }

  async set<T>(
    name: string,
    override: FlagOverrideValue<T>,
    updatedBy: string,
  ): Promise<FlagOverrideRecord<T>> {
    const record = await this.inner.set(name, override, updatedBy)
    this.cache.set(name, {
      value: record as FlagOverrideRecord,
      expiresAt: this.clock.now() + this.cacheTtlMs,
    })
    return record
  }

  async delete(name: string): Promise<void> {
    await this.inner.delete(name)
    this.cache.delete(name)
  }

  async getAll(): Promise<Record<string, FlagOverrideRecord>> {
    return this.inner.getAll()
  }
}
