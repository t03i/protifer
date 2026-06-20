import type { Plan, SheddingConfig } from '@protifer/shared'

import type { SheddingStateSnapshot } from './state.ts'

export type SheddingCode = 'OVERLOADED' | 'UPSTREAM_DOWN'

export interface AdmissionDecision {
  admit: boolean
  code?: SheddingCode
  estimatedWaitSeconds: number
  retryAfterSeconds?: number
}

export interface DecideInput {
  state: SheddingStateSnapshot
  config: SheddingConfig
  plan: Plan
  /** Account's resolved SLO seconds; falls back to `config.sloSeconds[plan]`. */
  sloSeconds?: number
  sequenceResidues: number
  nowMs: number
  jitter?: () => number
}

/** Default randomness source; injectable so tests can be deterministic. */
function defaultJitter(): number {
  return Math.random()
}

function jitteredRetry(
  baseSeconds: number,
  fraction: number,
  rand: () => number,
): number {
  const half = fraction / 2
  const factor = 1 - half + rand() * fraction
  const jittered = Math.max(0, baseSeconds * factor)
  return Math.max(0, Math.ceil(jittered))
}

/**
 * Pure admission-decision function. Given a snapshot of the shedding
 * state and the active config, decides whether to admit the request.
 *
 * Order of evaluation:
 *   1. Staleness guard — if no completion for a while AND queue non-empty,
 *      treat as UPSTREAM_DOWN (sheds even enterprise=0).
 *   2. Plan SLO — if the configured SLO for the plan is 0, never shed for
 *      overload. Otherwise shed when estimatedWait > SLO.
 */
export function decideAdmission(input: DecideInput): AdmissionDecision {
  const { state, config, plan, sequenceResidues, nowMs } = input
  const rand = input.jitter ?? defaultJitter

  const projectedPending = Math.max(
    0,
    state.pendingResidues + Math.max(0, sequenceResidues),
  )
  const throughput =
    state.residuesPerSecondEwma > 0
      ? state.residuesPerSecondEwma
      : config.initialResiduesPerSecond
  const estimatedWaitSeconds = projectedPending / throughput

  const isStale =
    state.lastCompletionTimestampMs !== null &&
    nowMs - state.lastCompletionTimestampMs > config.stalenessSeconds * 1000 &&
    state.pendingResidues > 0

  if (isStale) {
    const retry = jitteredRetry(
      config.stalenessSeconds,
      config.retryJitterFraction,
      rand,
    )
    return {
      admit: false,
      code: 'UPSTREAM_DOWN',
      estimatedWaitSeconds,
      retryAfterSeconds: retry,
    }
  }

  const slo = input.sloSeconds ?? config.sloSeconds[plan]
  if (slo === 0) {
    return { admit: true, estimatedWaitSeconds }
  }

  if (estimatedWaitSeconds > slo) {
    const retry = jitteredRetry(
      estimatedWaitSeconds,
      config.retryJitterFraction,
      rand,
    )
    return {
      admit: false,
      code: 'OVERLOADED',
      estimatedWaitSeconds,
      retryAfterSeconds: retry,
    }
  }

  return { admit: true, estimatedWaitSeconds }
}
