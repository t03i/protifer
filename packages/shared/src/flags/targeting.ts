import type {
  EvaluationContext,
  FlagDefinition,
  FlagOverrideValue,
  GlobalOverride,
  PercentageOverride,
  PlanOverride,
} from './types.ts'

function assertNever<T>(_x: never, fallback: T): T {
  return fallback
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function stableBucket(flagName: string, userId: string): number {
  return fnv1a(`${flagName}:${userId}`) % 100
}

function isGlobal<T>(o: FlagOverrideValue<T>): o is GlobalOverride<T> {
  return 'value' in o && !('percentage' in o)
}

function isPercentage<T>(o: FlagOverrideValue<T>): o is PercentageOverride<T> {
  return 'percentage' in o && 'value' in o
}

function isPlan<T>(o: FlagOverrideValue<T>): o is PlanOverride<T> {
  return 'perPlan' in o
}

export function evaluateGlobal<T>(
  definition: FlagDefinition<T>,
  override: FlagOverrideValue<T> | null,
): T {
  if (override && isGlobal(override)) return override.value
  return definition.default
}

export function evaluatePlan<T>(
  definition: FlagDefinition<T>,
  override: FlagOverrideValue<T> | null,
  ctx: EvaluationContext,
): T {
  if (!override || !isPlan(override)) return definition.default
  if (!ctx.plan) return definition.default
  const value = override.perPlan[ctx.plan]
  return value === undefined ? definition.default : value
}

export function evaluatePercentage<T>(
  flagName: string,
  definition: FlagDefinition<T>,
  override: FlagOverrideValue<T> | null,
  ctx: EvaluationContext,
): T {
  if (!override || !isPercentage(override)) return definition.default
  if (!ctx.userId) return definition.default
  const pct = Math.max(0, Math.min(100, override.percentage))
  if (pct === 0) return definition.default
  if (pct === 100) return override.value
  return stableBucket(flagName, ctx.userId) < pct
    ? override.value
    : definition.default
}

export function evaluate<T>(
  flagName: string,
  definition: FlagDefinition<T>,
  override: FlagOverrideValue<T> | null,
  ctx: EvaluationContext,
): T {
  switch (definition.targeting) {
    case 'global':
      return evaluateGlobal(definition, override)
    case 'plan':
      return evaluatePlan(definition, override, ctx)
    case 'percentage':
      return evaluatePercentage(flagName, definition, override, ctx)
    default:
      return assertNever(definition.targeting, definition.default)
  }
}
