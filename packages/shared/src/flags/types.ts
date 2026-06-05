import type { z } from 'zod'

import type { Plan } from '../types.ts'

export type TargetingMode = 'global' | 'plan' | 'percentage'

export interface EvaluationContext {
  userId?: string
  plan?: Plan
}

export interface FlagDefinition<T = unknown> {
  description: string
  type: z.ZodType<T>
  default: T
  targeting: TargetingMode
  owner: string
  createdAt: string
  expiresAt: string
  /** When true, the provider returns `default` (and never the override) when `NODE_ENV === 'production'`. */
  productionSafe?: boolean
}

export type GlobalOverride<T> = { value: T }
export type PlanOverride<T> = { perPlan: Partial<Record<Plan, T>> }
export type PercentageOverride<T> = { percentage: number; value: T }

export type FlagOverrideValue<T> =
  | GlobalOverride<T>
  | PlanOverride<T>
  | PercentageOverride<T>

export interface FlagOverrideRecord<T = unknown> {
  override: FlagOverrideValue<T>
  updatedAt: string
  updatedBy: string
}

export type FlagRegistry = Record<string, FlagDefinition>
