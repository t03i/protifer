import { ErrorCode, StandardResolutionReasons } from '@openfeature/server-sdk'
import type {
  EvaluationContext as OFEvaluationContext,
  JsonValue,
  Provider,
  ProviderMetadata,
  ResolutionDetails,
} from '@openfeature/server-sdk'

import type { Plan } from '../types.ts'
import type { FlagOverrideStore } from './store.ts'
import { evaluate } from './targeting.ts'
import type {
  EvaluationContext,
  FlagDefinition,
  FlagOverrideValue,
  FlagRegistry,
} from './types.ts'

export interface FlagsProviderOptions {
  registry: FlagRegistry
  store: FlagOverrideStore
  /** Reads `process.env['NODE_ENV']` by default. Used for `productionSafe` enforcement. */
  getNodeEnv?: () => string | undefined
}

const FLAGS_PROVIDER_NAME = 'FlagsProvider'

function toCtx(of: OFEvaluationContext): EvaluationContext {
  const userId = typeof of['userId'] === 'string' ? of['userId'] : undefined
  const targetingKey =
    typeof of.targetingKey === 'string' ? of.targetingKey : undefined
  const plan =
    of['plan'] === 'free' || of['plan'] === 'pro' || of['plan'] === 'enterprise'
      ? (of['plan'] as Plan)
      : undefined
  return { userId: userId ?? targetingKey, plan }
}

function defaultDetails<T>(
  value: T,
  errorCode: ErrorCode,
  errorMessage: string,
): ResolutionDetails<T> {
  return {
    value,
    reason: StandardResolutionReasons.ERROR,
    errorCode,
    errorMessage,
  }
}

export class FlagsProvider implements Provider {
  readonly metadata: ProviderMetadata = { name: FLAGS_PROVIDER_NAME }
  readonly runsOn = 'server' as const

  constructor(private readonly opts: FlagsProviderOptions) {}

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: OFEvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    return this.resolve('boolean', flagKey, defaultValue, context)
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: OFEvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    return this.resolve('string', flagKey, defaultValue, context)
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: OFEvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    return this.resolve('number', flagKey, defaultValue, context)
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: OFEvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    return this.resolve('object', flagKey, defaultValue, context)
  }

  private async resolve<T>(
    expectedType: 'boolean' | 'string' | 'number' | 'object',
    flagKey: string,
    defaultValue: T,
    of: OFEvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    const def = this.opts.registry[flagKey] as FlagDefinition<T> | undefined
    if (!def) {
      return defaultDetails(
        defaultValue,
        ErrorCode.FLAG_NOT_FOUND,
        `Flag "${flagKey}" is not in the registry`,
      )
    }

    if (!matchesType(def.default, expectedType)) {
      return defaultDetails(
        defaultValue,
        ErrorCode.TYPE_MISMATCH,
        `Flag "${flagKey}" registry default is not a ${expectedType}`,
      )
    }

    let override: FlagOverrideValue<T> | null = null
    try {
      const record = await this.opts.store.get<T>(flagKey)
      override = record ? record.override : null
    } catch (err) {
      return defaultDetails(
        def.default,
        ErrorCode.GENERAL,
        `Override store unavailable: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    let value: T
    try {
      value = evaluate(flagKey, def, override, toCtx(of))
    } catch (err) {
      return defaultDetails(
        def.default,
        ErrorCode.GENERAL,
        `Targeting evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    const parsed = def.type.safeParse(value)
    if (!parsed.success) {
      return defaultDetails(
        def.default,
        ErrorCode.TYPE_MISMATCH,
        `Resolved value fails registry type for "${flagKey}"`,
      )
    }

    if (def.productionSafe && override !== null) {
      const env = this.opts.getNodeEnv
        ? this.opts.getNodeEnv()
        : process.env['NODE_ENV']
      if (env === 'production') {
        // Suppression is expected behavior, not an error — emit DISABLED
        // (not ERROR) so Prometheus/Sentry hooks don't classify it as a fault.
        return {
          value: def.default,
          reason: StandardResolutionReasons.DISABLED,
        }
      }
    }

    const reason = override
      ? StandardResolutionReasons.TARGETING_MATCH
      : StandardResolutionReasons.DEFAULT
    return { value, reason }
  }
}

function matchesType(
  value: unknown,
  expected: 'boolean' | 'string' | 'number' | 'object',
): boolean {
  switch (expected) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'object':
      return value !== null && typeof value === 'object'
  }
}
