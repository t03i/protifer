import { z } from 'zod'

import { readConfig } from '../config.ts'
import { parseBoolean } from '../plan.ts'
import { defineFlags } from './registry.ts'
import type { FlagDefinition } from './types.ts'

interface FlagDefaults {
  sheddingEnabled?: boolean
  sheddingEnforce?: boolean
  correlationContextEnabled?: boolean
}

// Exported for direct-path test imports (definitions.test.ts); intentionally
// not part of the package's public surface.
export function buildAppFlagRegistry(defaults: FlagDefaults = {}) {
  const sheddingEnabled: FlagDefinition<boolean> = {
    description: 'Master switch for the request-shedding admission middleware.',
    type: z.boolean(),
    default:
      defaults.sheddingEnabled ??
      parseBoolean(readConfig('SHED_ENABLED'), true),
    targeting: 'global',
    owner: 'platform',
    createdAt: '2026-04-25',
    expiresAt: '2026-10-25',
  }

  const sheddingEnforce: FlagDefinition<boolean> = {
    description:
      'Block requests over plan SLO with 503 + Retry-After. When false, runs in shadow mode (logging only).',
    type: z.boolean(),
    default: defaults.sheddingEnforce ?? readConfig('SHED_MODE') === 'enforce',
    targeting: 'global',
    owner: 'platform',
    createdAt: '2026-04-25',
    expiresAt: '2026-10-25',
  }

  const correlationContextEnabled: FlagDefinition<boolean> = {
    description:
      'Enables per-request correlation context (request_id, trace_id) and submission-event logs.',
    type: z.boolean(),
    default: defaults.correlationContextEnabled ?? true,
    targeting: 'global',
    owner: 'platform',
    createdAt: '2026-05-12',
    expiresAt: '2026-11-12',
    productionSafe: false,
  }

  return defineFlags({
    'shedding.enabled': sheddingEnabled,
    'shedding.enforce': sheddingEnforce,
    'correlation-context-enabled': correlationContextEnabled,
  })
}

// Captured at import time. Env mutation after this module loads will not
// re-read; tests that need different defaults should call
// `buildAppFlagRegistry({ ... })` directly.
export const FLAG_REGISTRY = buildAppFlagRegistry()
