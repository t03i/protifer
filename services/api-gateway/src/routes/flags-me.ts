import type {
  EvaluationContext,
  FlagOverrideStore,
  FlagRegistry,
} from '@protifer/shared'
import { evaluate } from '@protifer/shared'
import { Hono } from 'hono'

import type { Variables } from '../types/hono.ts'

export interface FlagsMeDeps {
  registry: FlagRegistry
  store: FlagOverrideStore
  /** Per-user evaluated cache TTL. Defaults to 5s. */
  cacheTtlMs?: number
  /** Max distinct (user|plan) keys retained. LRU eviction past this. Defaults to 10_000. */
  cacheMaxEntries?: number
  clock?: { now(): number }
}

interface CacheEntry {
  value: Record<string, unknown>
  expiresAt: number
}

export function createFlagsMeRouter(deps: FlagsMeDeps) {
  const { registry, store } = deps
  const ttl = deps.cacheTtlMs ?? 5_000
  const maxEntries = deps.cacheMaxEntries ?? 10_000
  const now = () => (deps.clock ? deps.clock.now() : Date.now())
  // Map iteration order = insertion order, so re-inserting on hit promotes
  // to MRU and `cache.keys().next()` returns the LRU key for eviction.
  const cache = new Map<string, CacheEntry>()
  const router = new Hono<{ Variables: Variables }>()

  router.get('/', async (c) => {
    const auth = c.get('auth')
    const cacheKey = `${auth.sub}|${auth.plan}`
    const t = now()
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > t) {
      cache.delete(cacheKey)
      cache.set(cacheKey, cached)
      return c.json({ evaluatedFlags: cached.value }, 200)
    }
    if (cached) cache.delete(cacheKey)
    const evaluatedFlags: Record<string, unknown> = {}
    const ctx: EvaluationContext = { userId: auth.sub, plan: auth.plan }
    for (const [name, def] of Object.entries(registry)) {
      const record = await store.get(name)
      evaluatedFlags[name] = evaluate(name, def, record?.override ?? null, ctx)
    }
    cache.set(cacheKey, { value: evaluatedFlags, expiresAt: t + ttl })
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return c.json({ evaluatedFlags }, 200)
  })

  return router
}
