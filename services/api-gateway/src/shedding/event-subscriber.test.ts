import { EventEmitter } from 'events'

import { loadSheddingConfig } from '@protifer/shared'
import RedisMock from 'ioredis-mock'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  ACCOUNTING_LOCK_KEY,
  startEventSubscriber,
} from './event-subscriber.ts'
import { createShedingState } from './state.ts'
import type { SheddingRedis } from './state.ts'
import type { RedisCommands } from '../queue.ts'

type LeaderRedis = SheddingRedis & RedisCommands

function makeRedis(): LeaderRedis {
  const RedisCtor = RedisMock as unknown as new () => RedisMock
  return new RedisCtor() as unknown as LeaderRedis
}

function makeFakeEvents() {
  const emitter = Object.assign(new EventEmitter(), {
    close: vi.fn().mockResolvedValue(undefined),
  })
  return emitter
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

function makeJob({
  sequence,
  processedOn,
  finishedOn,
}: {
  sequence: string
  processedOn?: number
  finishedOn?: number
}) {
  return {
    data: { sequence },
    processedOn: processedOn ?? 1_000,
    finishedOn: finishedOn ?? 3_000,
  }
}

describe('startEventSubscriber', () => {
  let redis: LeaderRedis

  beforeEach(async () => {
    vi.clearAllMocks()
    redis = makeRedis()
    await (redis as unknown as { flushall: () => Promise<unknown> }).flushall()
  })

  it('exactly one of two subscribers acquires the lock and processes events', async () => {
    const job = makeJob({
      sequence: 'ABCDE',
      processedOn: 1000,
      finishedOn: 3000,
    })
    const queue = {
      getJob: vi.fn().mockResolvedValue(job),
    } as unknown as Parameters<typeof startEventSubscriber>[0]['embeddingQueue']

    const config = loadSheddingConfig({})
    const stateA = createShedingState({ redis, config })
    const stateB = createShedingState({ redis, config })
    const eventsA = makeFakeEvents()
    const eventsB = makeFakeEvents()

    const subA = startEventSubscriber({
      redis,
      connection: {} as never,
      embeddingQueue: queue,
      state: stateA,
      logger: mockLogger,
      instanceId: 'A',
      lockTtlMs: 5_000,
      renewIntervalMs: 1_000_000, // no renewal during test
      queueEventsFactory: () => eventsA,
    })
    const subB = startEventSubscriber({
      redis,
      connection: {} as never,
      embeddingQueue: queue,
      state: stateB,
      logger: mockLogger,
      instanceId: 'B',
      lockTtlMs: 5_000,
      renewIntervalMs: 1_000_000,
      queueEventsFactory: () => eventsB,
    })

    await new Promise((r) => setTimeout(r, 50))

    const leaderCount = Number(subA.isLeader()) + Number(subB.isLeader())
    expect(leaderCount).toBe(1)

    // Both emit the same completed event; only the leader should act on it
    eventsA.emit('completed', { jobId: 'job-1' })
    eventsB.emit('completed', { jobId: 'job-1' })
    await new Promise((r) => setTimeout(r, 20))

    const snap = await stateA.readState()
    // Only one should have decremented (starting at 0 → -5)
    expect(snap.pendingResidues).toBe(-5)

    await subA.close()
    await subB.close()
  })

  it('releases the lock on close', async () => {
    const config = loadSheddingConfig({})
    const state = createShedingState({ redis, config })
    const events = makeFakeEvents()
    const queue = {
      getJob: vi.fn().mockResolvedValue(null),
    } as unknown as Parameters<typeof startEventSubscriber>[0]['embeddingQueue']

    const sub = startEventSubscriber({
      redis,
      connection: {} as never,
      embeddingQueue: queue,
      state,
      logger: mockLogger,
      instanceId: 'only',
      lockTtlMs: 5_000,
      renewIntervalMs: 1_000_000,
      queueEventsFactory: () => events,
    })

    await new Promise((r) => setTimeout(r, 30))
    expect(sub.isLeader()).toBe(true)

    await sub.close()
    const lockVal = await (
      redis as unknown as {
        get: (k: string) => Promise<string | null>
      }
    ).get(ACCOUNTING_LOCK_KEY)
    expect(lockVal).toBeNull()
    expect(events.close).toHaveBeenCalled()
  })

  it('on completed: decrements pending residues and records throughput', async () => {
    const job = makeJob({
      sequence: 'AAAA',
      processedOn: 1000,
      finishedOn: 5000,
    })
    const queue = {
      getJob: vi.fn().mockResolvedValue(job),
    } as unknown as Parameters<typeof startEventSubscriber>[0]['embeddingQueue']

    const config = loadSheddingConfig({ SHED_ALPHA: '1' })
    const state = createShedingState({ redis, config })
    await state.incrementPending(10)
    const events = makeFakeEvents()

    const sub = startEventSubscriber({
      redis,
      connection: {} as never,
      embeddingQueue: queue,
      state,
      logger: mockLogger,
      instanceId: 'only',
      lockTtlMs: 5_000,
      renewIntervalMs: 1_000_000,
      queueEventsFactory: () => events,
    })
    await new Promise((r) => setTimeout(r, 30))

    events.emit('completed', { jobId: 'j1' })
    await new Promise((r) => setTimeout(r, 20))

    const snap = await state.readState()
    // Started at 10, decrement 4 → 6
    expect(snap.pendingResidues).toBe(6)
    // sample = 4 residues / 4s = 1 r/s, alpha=1 → ewma=1
    expect(snap.residuesPerSecondEwma).toBeCloseTo(1)

    await sub.close()
  })
})
