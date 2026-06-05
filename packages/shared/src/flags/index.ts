// types.ts: the override types (`GlobalOverride` / `PlanOverride` /
// `PercentageOverride` / `FlagOverrideValue` / `FlagOverrideRecord`) and
// `TargetingMode` stay internal — siblings import them via direct path.
export type {
  EvaluationContext,
  FlagDefinition,
  FlagRegistry,
} from './types.ts'
export * from './registry.ts'
// targeting.ts: only `evaluate` is public; the per-mode evaluators and
// `stableBucket` stay internal (tested via direct module path).
export { evaluate } from './targeting.ts'
export * from './store.ts'
export * from './provider.ts'
export * from './lint.ts'
// definitions.ts: `buildAppFlagRegistry` stays internal (tested via direct path).
export { FLAG_REGISTRY } from './definitions.ts'
