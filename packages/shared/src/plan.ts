import { zBooleanString } from './config.ts'
import type { Plan } from './types.ts'

export interface PlanResolver {
  resolve(userId: string, email: string): Promise<Plan>
}

export const PLAN_LIMITS: Record<
  Plan,
  { submissionsPerMinute: number; maxConcurrentJobs: number }
> = {
  free: { submissionsPerMinute: 10, maxConcurrentJobs: 2 },
  pro: { submissionsPerMinute: 60, maxConcurrentJobs: 10 },
  enterprise: { submissionsPerMinute: 300, maxConcurrentJobs: 50 },
}

/**
 * Maximum residues accepted for a single-sequence prediction or embedding
 * submission.
 *
 * Biologically, the vast majority of single-chain proteins are well under
 * 2048 residues (UniProt median ~375; titin at ~35000 is the extreme
 * outlier and not a target for these models). The underlying Triton models
 * also degrade / OOM on very long inputs. 4096 gives a comfortable ceiling
 * above the realistic 99th-percentile single chain while preventing
 * multi-MB payloads from tying up a GPU.
 */
export const MAX_SEQUENCE_LENGTH = 4096

/**
 * BullMQ job priority per plan — lower integer = higher priority
 * (drained first). Admitted jobs carry this on both the parent prediction
 * job and the embedding child so paying tiers overtake free-tier work
 * already sitting in the queue.
 */
export const DEFAULT_PLAN_PRIORITY: Record<Plan, number> = {
  enterprise: 1,
  pro: 2,
  free: 3,
}

export const SHEDDING_DEFAULTS = {
  SHED_ENABLED: true,
  SHED_MODE: 'shadow' as 'shadow' | 'enforce',
  SHED_ALPHA: 0.2,
  SHED_STALENESS_SECONDS: 60,
  SHED_SLO_FREE_SECONDS: 30,
  SHED_SLO_PRO_SECONDS: 120,
  SHED_SLO_ENTERPRISE_SECONDS: 0,
  SHED_INITIAL_RESIDUES_PER_SECOND: 2000,
  SHED_RETRY_JITTER_FRACTION: 0.3,
} as const

export interface SheddingConfig {
  enabled: boolean
  mode: 'shadow' | 'enforce'
  alpha: number
  stalenessSeconds: number
  sloSeconds: Record<Plan, number>
  initialResiduesPerSecond: number
  retryJitterFraction: number
  priority: Record<Plan, number>
}

/**
 * Fallback-aware adapter over the single boolean parser (`zBooleanString`).
 * Returns `fallback` when unset; throws on an unparseable value.
 */
export function parseBoolean(
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw === undefined) return fallback
  const result = zBooleanString.safeParse(raw)
  if (!result.success) {
    throw new Error(`invalid boolean env value: "${raw}"`)
  }
  return result.data
}

function parseNumber(
  raw: string | undefined,
  fallback: number,
  { min, max, integer }: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`invalid numeric env value: "${raw}"`)
  }
  if (integer && !Number.isInteger(n)) {
    throw new Error(`expected integer env value, got: "${raw}"`)
  }
  if (min !== undefined && n < min) {
    throw new Error(`env value below minimum (${String(min)}): ${String(n)}`)
  }
  if (max !== undefined && n > max) {
    throw new Error(`env value above maximum (${String(max)}): ${String(n)}`)
  }
  return n
}

/**
 * Build the shedding config from a key/value source (defaults to
 * `process.env`). Throws on invalid values so callers can surface a
 * descriptive fail-fast startup error.
 */
export function loadSheddingConfig(
  env: Record<string, string | undefined> = process.env,
): SheddingConfig {
  const mode = env['SHED_MODE'] ?? SHEDDING_DEFAULTS.SHED_MODE
  if (mode !== 'shadow' && mode !== 'enforce') {
    throw new Error(`SHED_MODE must be "shadow" or "enforce", got: "${mode}"`)
  }
  return {
    enabled: parseBoolean(env['SHED_ENABLED'], SHEDDING_DEFAULTS.SHED_ENABLED),
    mode,
    alpha: parseNumber(env['SHED_ALPHA'], SHEDDING_DEFAULTS.SHED_ALPHA, {
      min: 0,
      max: 1,
    }),
    stalenessSeconds: parseNumber(
      env['SHED_STALENESS_SECONDS'],
      SHEDDING_DEFAULTS.SHED_STALENESS_SECONDS,
      { min: 0, integer: true },
    ),
    sloSeconds: {
      free: parseNumber(
        env['SHED_SLO_FREE_SECONDS'],
        SHEDDING_DEFAULTS.SHED_SLO_FREE_SECONDS,
        { min: 0, integer: true },
      ),
      pro: parseNumber(
        env['SHED_SLO_PRO_SECONDS'],
        SHEDDING_DEFAULTS.SHED_SLO_PRO_SECONDS,
        { min: 0, integer: true },
      ),
      enterprise: parseNumber(
        env['SHED_SLO_ENTERPRISE_SECONDS'],
        SHEDDING_DEFAULTS.SHED_SLO_ENTERPRISE_SECONDS,
        { min: 0, integer: true },
      ),
    },
    initialResiduesPerSecond: parseNumber(
      env['SHED_INITIAL_RESIDUES_PER_SECOND'],
      SHEDDING_DEFAULTS.SHED_INITIAL_RESIDUES_PER_SECOND,
      { min: 1 },
    ),
    retryJitterFraction: parseNumber(
      env['SHED_RETRY_JITTER_FRACTION'],
      SHEDDING_DEFAULTS.SHED_RETRY_JITTER_FRACTION,
      { min: 0, max: 1 },
    ),
    priority: {
      free: parseNumber(env['PLAN_PRIORITY_FREE'], DEFAULT_PLAN_PRIORITY.free, {
        min: 1,
        integer: true,
      }),
      pro: parseNumber(env['PLAN_PRIORITY_PRO'], DEFAULT_PLAN_PRIORITY.pro, {
        min: 1,
        integer: true,
      }),
      enterprise: parseNumber(
        env['PLAN_PRIORITY_ENTERPRISE'],
        DEFAULT_PLAN_PRIORITY.enterprise,
        { min: 1, integer: true },
      ),
    },
  }
}
