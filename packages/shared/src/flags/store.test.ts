import { describe, expect, it, vi } from 'vitest'

import { CachedFlagOverrideStore, InMemoryFlagOverrideStore } from './store.ts'

describe('InMemoryFlagOverrideStore', () => {
  it('round-trips set/get/delete', async () => {
    const store = new InMemoryFlagOverrideStore()
    const rec = await store.set('f', { value: true }, 'admin')
    expect(rec.override).toEqual({ value: true })
    expect(rec.updatedBy).toBe('admin')
    expect(rec.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const got = await store.get<boolean>('f')
    expect(got?.override).toEqual({ value: true })

    await store.delete('f')
    expect(await store.get('f')).toBeNull()
  })

  it('getAll returns every set flag', async () => {
    const store = new InMemoryFlagOverrideStore()
    await store.set('a', { value: true }, 'me')
    await store.set('b', { perPlan: { free: false } }, 'me')
    const all = await store.getAll()
    expect(Object.keys(all).sort()).toEqual(['a', 'b'])
  })
})

describe('CachedFlagOverrideStore', () => {
  it('caches reads within ttl', async () => {
    const inner = new InMemoryFlagOverrideStore()
    await inner.set('f', { value: true }, 'me')
    const spy = vi.spyOn(inner, 'get')
    const cached = new CachedFlagOverrideStore(inner, 5_000)

    await cached.get('f')
    await cached.get('f')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('expires cache after ttl', async () => {
    const inner = new InMemoryFlagOverrideStore()
    await inner.set('f', { value: true }, 'me')
    let now = 1000
    const clock = { now: () => now }
    const cached = new CachedFlagOverrideStore(inner, 5_000, clock)

    await cached.get('f')
    now += 6_000
    const spy = vi.spyOn(inner, 'get')
    await cached.get('f')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('invalidates on set/delete', async () => {
    const inner = new InMemoryFlagOverrideStore()
    await inner.set('f', { value: false }, 'me')
    const cached = new CachedFlagOverrideStore(inner, 5_000)

    await cached.get('f')
    await cached.set('f', { value: true }, 'me')
    const got = await cached.get<boolean>('f')
    expect(got?.override).toEqual({ value: true })

    await cached.delete('f')
    expect(await cached.get('f')).toBeNull()
  })
})
