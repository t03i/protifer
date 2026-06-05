import { loadSheddingConfig } from '@protifer/shared'
import RedisMock from 'ioredis-mock'
import { describe, it, expect, beforeEach } from 'vitest'

import {
  PENDING_RESIDUES_KEY,
  THROUGHPUT_KEY,
  createShedingState,
} from './state.ts'
import type { SheddingRedis } from './state.ts'

function makeRedis(): SheddingRedis {
  const RedisCtor = RedisMock as unknown as new () => RedisMock
  return new RedisCtor() as unknown as SheddingRedis
}

describe('createShedingState', () => {
  let redis: SheddingRedis
  beforeEach(async () => {
    redis = makeRedis()
    // ioredis-mock shares its keyspace across instances — flush so prior tests
    // cannot leak state.
    await (redis as unknown as { flushall: () => Promise<unknown> }).flushall()
  })

  it('incrementPending adds residues atomically', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
    })
    const a = await state.incrementPending(100)
    const b = await state.incrementPending(250)
    expect(a).toBe(100)
    expect(b).toBe(350)
    const snap = await state.readState()
    expect(snap.pendingResidues).toBe(350)
  })

  it('decrementPending subtracts residues', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
    })
    await state.incrementPending(500)
    const after = await state.decrementPending(200)
    expect(after).toBe(300)
  })

  it('readState seeds EWMA from config before any samples', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({ SHED_INITIAL_RESIDUES_PER_SECOND: '1500' }),
    })
    const snap = await state.readState()
    expect(snap.residuesPerSecondEwma).toBe(1500)
    expect(snap.lastCompletionTimestampMs).toBeNull()
  })

  it('recordCompletion updates EWMA with α * sample + (1 − α) * prev', async () => {
    const config = loadSheddingConfig({
      SHED_ALPHA: '0.5',
      SHED_INITIAL_RESIDUES_PER_SECOND: '100',
    })
    const state = createShedingState({
      redis,
      config,
      clock: { now: () => 1_000_000 },
    })

    // first sample seeds EWMA (prev missing → new = sample)
    const first = await state.recordCompletion(200, 2) // 100 r/s
    expect(first).toBeCloseTo(100)

    const second = await state.recordCompletion(400, 2) // 200 r/s
    expect(second).toBeCloseTo(150) // 0.5 * 200 + 0.5 * 100
  })

  it('recordCompletion ignores zero or negative inputs', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
    })
    const r1 = await state.recordCompletion(0, 1)
    const r2 = await state.recordCompletion(10, 0)
    const r3 = await state.recordCompletion(10, -1)
    expect(r1).toBe(0)
    expect(r2).toBe(0)
    expect(r3).toBe(0)
    const snap = await state.readState()
    expect(snap.lastCompletionTimestampMs).toBeNull()
  })

  it('readState exposes last-sample timestamp after a completion', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
      clock: { now: () => 42_000 },
    })
    await state.recordCompletion(1000, 1)
    const snap = await state.readState()
    expect(snap.lastCompletionTimestampMs).toBe(42_000)
  })

  it('uses the documented Redis keys', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
    })
    await state.incrementPending(10)
    const raw = await (
      redis as unknown as {
        get: (k: string) => Promise<string | null>
      }
    ).get(PENDING_RESIDUES_KEY)
    expect(raw).toBe('10')

    await state.recordCompletion(20, 2)
    const ewmaRaw = await redis.hget(THROUGHPUT_KEY, 'value')
    expect(ewmaRaw).not.toBeNull()
  })
})
