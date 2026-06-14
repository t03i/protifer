import { loadSheddingConfig } from '@protifer/shared'
import RedisMock from 'ioredis-mock'
import { describe, it, expect, beforeEach } from 'vitest'

import {
  PENDING_RESIDUES_KEY,
  THROUGHPUT_KEY,
  ADMITTED_RESIDUES_KEY,
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

  it('setPending overwrites drifted value (absolute, not additive)', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
    })
    await state.incrementPending(999) // drift accumulated between sweeps
    const v = await state.setPending(350)
    expect(v).toBe(350)
    const snap = await state.readState()
    expect(snap.pendingResidues).toBe(350)
  })

  it('setPending clamps negative input to zero', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
    })
    expect(await state.setPending(-50)).toBe(0)
    const snap = await state.readState()
    expect(snap.pendingResidues).toBe(0)
  })

  it('sampleThroughput drain rate = (arrivals − Δpending) / Δt', async () => {
    let t = 1_000_000
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({ SHED_ALPHA: '1' }), // ewma = sample
      clock: { now: () => t },
    })

    // first sweep: no prior snapshot → null, records snapshot (admitted/pending=0)
    expect(await state.sampleThroughput(0)).toBeNull()

    // between sweeps: 1000 admitted, 800 drained so pending now 200
    await state.incrAdmitted(1000)
    t += 2000 // Δt = 2s
    const rate = await state.sampleThroughput(200)
    // departures = max(0, 1000 − 200) = 800 → 800 / 2s = 400 r/s, aggregate
    expect(rate).toBeCloseTo(400)
    const snap = await state.readState()
    expect(snap.residuesPerSecondEwma).toBeCloseTo(400)
  })

  it('sampleThroughput clamps negative departures to zero', async () => {
    let t = 0
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({ SHED_ALPHA: '1' }),
      clock: { now: () => t },
    })
    await state.sampleThroughput(0) // snapshot pending=0, admitted=0
    // pending rose with no arrivals (snapshot-timing skew) → departures clamped
    t += 1000
    expect(await state.sampleThroughput(500)).toBe(0)
  })

  it('sampleThroughput returns null on first sweep (no prior snapshot)', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
      clock: { now: () => 5 },
    })
    expect(await state.sampleThroughput(0)).toBeNull()
  })

  it('sampleThroughput skips the EWMA update when Δt ≈ 0', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
      clock: { now: () => 5 }, // constant clock → Δt = 0
    })
    await state.sampleThroughput(0)
    await state.incrAdmitted(100)
    expect(await state.sampleThroughput(50)).toBeNull()
    expect(await redis.hget(THROUGHPUT_KEY, 'value')).toBeNull()
  })

  it('cold start falls back to initialResiduesPerSecond until a valid sample', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({ SHED_INITIAL_RESIDUES_PER_SECOND: '1500' }),
      clock: { now: () => 1 },
    })
    await state.sampleThroughput(0) // null, no EWMA write yet
    const snap = await state.readState()
    expect(snap.residuesPerSecondEwma).toBe(1500)
  })

  it('uses the documented Redis keys', async () => {
    const state = createShedingState({
      redis,
      config: loadSheddingConfig({}),
    })
    await state.incrementPending(10)
    await state.incrAdmitted(40)
    const get = (
      redis as unknown as { get: (k: string) => Promise<string | null> }
    ).get.bind(redis)
    expect(await get(PENDING_RESIDUES_KEY)).toBe('10')
    expect(await get(ADMITTED_RESIDUES_KEY)).toBe('40')
  })
})
