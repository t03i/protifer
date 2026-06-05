import type {
  EvaluationDetails,
  FlagValue,
  Hook,
  HookContext,
} from '@openfeature/server-sdk'
import * as Sentry from '@sentry/node'
import type { Counter } from 'prom-client'

const KNOWN_PLANS = new Set(['free', 'pro', 'enterprise'])

function planFromCtx(ctx: HookContext['context']): string {
  const p = ctx['plan']
  return typeof p === 'string' && KNOWN_PLANS.has(p) ? p : 'unknown'
}

function outcomeFromDetails(
  details: EvaluationDetails<FlagValue>,
): 'default' | 'override' | 'error' {
  if (details.errorCode) return 'error'
  return details.reason === 'TARGETING_MATCH' ? 'override' : 'default'
}

export function createPrometheusFlagHook(
  counter: Counter<'flag' | 'outcome' | 'plan'>,
): Hook {
  return {
    after(hookContext, details) {
      counter.inc(
        {
          flag: hookContext.flagKey,
          outcome: outcomeFromDetails(details),
          plan: planFromCtx(hookContext.context),
        },
        1,
      )
    },
  }
}

interface ThrottleClock {
  now(): number
}

export interface SentryFlagHookOptions {
  /** Throttle window per (flag, plan) pair. Default 60s. */
  throttleMs?: number
  clock?: ThrottleClock
  /**
   * Optional sink override; defaults to `Sentry.addBreadcrumb`.
   * Mostly used for tests.
   */
  addBreadcrumb?: (b: {
    category: string
    data: Record<string, unknown>
  }) => void
}

// `value` is included in the breadcrumb. Flag values MUST stay non-sensitive
// (booleans, plan tier names, percentages — never PII or secrets).
export function createSentryFlagHook(opts: SentryFlagHookOptions = {}): Hook {
  const throttleMs = opts.throttleMs ?? 60_000
  const clock = opts.clock ?? Date
  const sink =
    opts.addBreadcrumb ??
    ((b) => {
      Sentry.addBreadcrumb(b)
    })
  const lastEmit = new Map<string, number>()

  return {
    after(hookContext, details) {
      const plan = planFromCtx(hookContext.context)
      const key = `${hookContext.flagKey}|${plan}`
      const now = clock.now()
      const prev = lastEmit.get(key)
      if (prev !== undefined && now - prev < throttleMs) return
      lastEmit.set(key, now)
      sink({
        category: 'feature-flag',
        data: {
          flag: hookContext.flagKey,
          outcome: outcomeFromDetails(details),
          plan,
          value: details.value,
          reason: details.reason,
        },
      })
    },
  }
}
