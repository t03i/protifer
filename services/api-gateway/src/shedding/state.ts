import type { SheddingConfig } from '@protifer/shared'

export const PENDING_RESIDUES_KEY = 'shedding:pending_residues'
export const THROUGHPUT_KEY = 'shedding:throughput_ewma'
export const EWMA_FIELD = 'value'
export const EWMA_TIMESTAMP_FIELD = 'last_sample_ms'
// Monotonic residues admitted at the gateway; feeds the drain-rate sampler.
export const ADMITTED_RESIDUES_KEY = 'shedding:admitted_residues_total'
// Prior-sweep snapshot the sampler diffs against to derive departures.
export const DRAIN_SNAPSHOT_KEY = 'shedding:drain_snapshot'

export interface SheddingStateSnapshot {
  pendingResidues: number
  residuesPerSecondEwma: number
  lastCompletionTimestampMs: number | null
}

/**
 * Minimal Redis surface needed by the shedding accounting functions.
 * Intentionally narrower than `RedisCommands` so the fake used in unit
 * tests only has to implement what's actually called.
 */
export interface SheddingRedis {
  incrby(key: string, amount: number): Promise<number>
  decrby(key: string, amount: number): Promise<number>
  set(key: string, value: string): Promise<string | null>
  get(key: string): Promise<string | null>
  hget(key: string, field: string): Promise<string | null>
  hset(key: string, ...values: string[]): Promise<number>
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>
  eval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number | string | null>
}

// Redis Lua script: atomically update `residues_per_second_ewma` using
// EWMA = α * sample + (1 − α) * previous.  Avoids the read-modify-write
// race that would otherwise fire under concurrent completion events.
// KEYS[1] = throughput hash, ARGV = [alpha, sample, now_ms]
// Returns the new EWMA value as a string.
const EWMA_UPDATE_SCRIPT = `
local key = KEYS[1]
local alpha = tonumber(ARGV[1])
local sample = tonumber(ARGV[2])
local now = ARGV[3]
local prev_raw = redis.call('HGET', key, 'value')
local prev
if prev_raw == false or prev_raw == nil then
  prev = sample
else
  prev = tonumber(prev_raw)
end
local next_val = alpha * sample + (1 - alpha) * prev
redis.call('HSET', key, 'value', tostring(next_val), 'last_sample_ms', now)
return tostring(next_val)
`

export interface StateDeps {
  redis: SheddingRedis
  config: SheddingConfig
  clock?: { now: () => number }
}

/**
 * Create the state accessor. Holds config so callers don't re-inject it
 * on every call.
 */
export function createShedingState(deps: StateDeps) {
  const { redis, config } = deps
  const now = deps.clock?.now ?? Date.now

  // increment/decrementPending are a between-sweeps fast-path hint only.
  // The leader sweep's `setPending` reconciliation is authoritative — drift
  // accumulated here (e.g. a missed terminal event) is overwritten each sweep.
  async function incrementPending(residues: number): Promise<number> {
    if (residues <= 0) return 0
    return redis.incrby(PENDING_RESIDUES_KEY, residues)
  }

  async function decrementPending(residues: number): Promise<number> {
    if (residues <= 0) return 0
    return redis.decrby(PENDING_RESIDUES_KEY, residues)
  }

  // Authoritative absolute write of the reconciled pending total (clamped
  // >= 0). Overwrites, not adjusts — discarding accumulated event drift.
  async function setPending(residues: number): Promise<number> {
    const value = Math.max(0, Math.floor(residues))
    await redis.set(PENDING_RESIDUES_KEY, String(value))
    return value
  }

  async function incrAdmitted(residues: number): Promise<number> {
    if (residues <= 0) return 0
    return redis.incrby(ADMITTED_RESIDUES_KEY, residues)
  }

  /**
   * Sweep-driven aggregate drain-rate sample. By flow conservation:
   *   departures = max(0, arrivals − Δpending)
   *   drain_rate = departures / Δt_seconds   (residues/sec, concurrency-aware)
   * `arrivals` is the monotonic admitted counter's delta since the prior
   * sweep; `Δpending` uses the just-reconciled `pendingNow`. Feeds the EWMA
   * and snapshots admitted/pending/timestamp for the next interval. Skips the
   * EWMA update (returns null) when no prior snapshot exists or Δt ≈ 0.
   */
  async function sampleThroughput(pendingNow: number): Promise<number | null> {
    const nowMs = now()
    const [admittedRaw, snap] = await Promise.all([
      redis.get(ADMITTED_RESIDUES_KEY),
      redis.hmget(DRAIN_SNAPSHOT_KEY, 'admitted', 'pending', 'ts'),
    ])
    const admittedTotal = admittedRaw === null ? 0 : Number(admittedRaw)
    const [prevAdmittedRaw, prevPendingRaw, prevTsRaw] = snap

    await redis.hset(
      DRAIN_SNAPSHOT_KEY,
      'admitted',
      String(admittedTotal),
      'pending',
      String(pendingNow),
      'ts',
      String(nowMs),
    )

    if (
      prevAdmittedRaw === null ||
      prevPendingRaw === null ||
      prevTsRaw === null
    ) {
      return null
    }
    const prevTs = Number(prevTsRaw)
    const dtSeconds = (nowMs - prevTs) / 1000
    if (!(dtSeconds > 0)) return null

    const arrivals = admittedTotal - Number(prevAdmittedRaw)
    const deltaPending = pendingNow - Number(prevPendingRaw)
    const departures = Math.max(0, arrivals - deltaPending)
    const drainRate = departures / dtSeconds

    await redis.eval(
      EWMA_UPDATE_SCRIPT,
      1,
      THROUGHPUT_KEY,
      String(config.alpha),
      String(drainRate),
      String(nowMs),
    )
    return drainRate
  }

  async function readState(): Promise<SheddingStateSnapshot> {
    const [pendingRaw, ewmaAndTs] = await Promise.all([
      redis.get(PENDING_RESIDUES_KEY),
      redis.hmget(THROUGHPUT_KEY, EWMA_FIELD, EWMA_TIMESTAMP_FIELD),
    ])
    const pending = pendingRaw === null ? 0 : Number(pendingRaw)
    const [ewmaRaw, tsRaw] = ewmaAndTs
    const ewma =
      ewmaRaw === null || ewmaRaw === undefined
        ? config.initialResiduesPerSecond
        : Number(ewmaRaw)
    const lastTs = tsRaw === null || tsRaw === undefined ? null : Number(tsRaw)
    return {
      pendingResidues: Number.isFinite(pending) ? pending : 0,
      residuesPerSecondEwma:
        Number.isFinite(ewma) && ewma > 0
          ? ewma
          : config.initialResiduesPerSecond,
      lastCompletionTimestampMs:
        lastTs !== null && Number.isFinite(lastTs) ? lastTs : null,
    }
  }

  return {
    incrementPending,
    decrementPending,
    setPending,
    incrAdmitted,
    sampleThroughput,
    readState,
  }
}

export type SheddingState = ReturnType<typeof createShedingState>
