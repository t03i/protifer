import type {
  AuthContext,
  EvaluationContext,
  FlagOverrideStore,
  FlagRegistry,
  Plan,
} from '@protifer/shared'
import { evaluate, FlagsProvider } from '@protifer/shared'
import { Hono } from 'hono'
import { z } from 'zod'

import type { Variables } from '../types/hono.ts'

export interface FlagsAdminDeps {
  registry: FlagRegistry
  store: FlagOverrideStore
  /** Defaults to `process.env['NODE_ENV']`; injectable for tests. */
  getNodeEnv?: () => string | undefined
}

const PlanSchema = z.enum(['free', 'pro', 'enterprise'])

const GlobalOverrideSchema = z.object({ value: z.unknown() }).strict()
const PlanOverrideSchema = z
  .object({
    perPlan: z.record(PlanSchema, z.unknown()),
  })
  .strict()
const PercentageOverrideSchema = z
  .object({
    percentage: z.number().min(0).max(100),
    value: z.unknown(),
  })
  .strict()

const OverrideBodySchema = z.union([
  GlobalOverrideSchema,
  PlanOverrideSchema,
  PercentageOverrideSchema,
])

function adminIdentity(c: { get: (k: 'auth') => AuthContext }): string {
  const auth = c.get('auth')
  return auth.email || auth.sub
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function createFlagsAdminRouter(deps: FlagsAdminDeps) {
  const { registry, store } = deps
  const router = new Hono<{ Variables: Variables }>()

  router.get('/', async (c) => {
    const today = todayIso()
    const all = await store.getAll()
    const entries = Object.entries(registry).map(([name, def]) => ({
      name,
      description: def.description,
      owner: def.owner,
      targeting: def.targeting,
      default: def.default,
      createdAt: def.createdAt,
      expiresAt: def.expiresAt,
      productionSafe: def.productionSafe ?? false,
      currentOverride: all[name] ?? null,
      expired: def.expiresAt < today,
    }))
    return c.json({ flags: entries }, 200)
  })

  router.put('/:name', async (c) => {
    const name = c.req.param('name')
    const def = registry[name]
    if (!def) {
      return c.json(
        { error: `Unknown flag: ${name}`, code: 'FLAG_NOT_FOUND' },
        404,
      )
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400)
    }
    const parsedShape = OverrideBodySchema.safeParse(body)
    if (!parsedShape.success) {
      return c.json(
        {
          error: parsedShape.error.issues[0]?.message ?? 'Invalid override',
          code: 'VALIDATION_ERROR',
        },
        400,
      )
    }
    const ov = parsedShape.data

    if ('value' in ov && !('percentage' in ov)) {
      const v = def.type.safeParse(ov.value)
      if (!v.success) {
        return c.json(
          {
            error: `Override value fails flag type: ${v.error.issues[0]?.message ?? ''}`,
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
      if (def.targeting !== 'global') {
        return c.json(
          {
            error: `Flag "${name}" is not global; expected ${def.targeting}-shaped override`,
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
    } else if ('perPlan' in ov) {
      if (def.targeting !== 'plan') {
        return c.json(
          {
            error: `Flag "${name}" is not plan-targeted`,
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
      for (const [plan, value] of Object.entries(ov.perPlan)) {
        const v = def.type.safeParse(value)
        if (!v.success) {
          return c.json(
            {
              error: `perPlan.${plan} fails flag type: ${v.error.issues[0]?.message ?? ''}`,
              code: 'VALIDATION_ERROR',
            },
            400,
          )
        }
      }
    } else if ('percentage' in ov) {
      if (def.targeting !== 'percentage') {
        return c.json(
          {
            error: `Flag "${name}" is not percentage-targeted`,
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
      const v = def.type.safeParse(ov.value)
      if (!v.success) {
        return c.json(
          {
            error: `Override value fails flag type: ${v.error.issues[0]?.message ?? ''}`,
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
    }

    const record = await store.set(
      name,
      ov as Parameters<typeof store.set>[1],
      adminIdentity(c),
    )
    return c.json(record, 200)
  })

  router.delete('/:name', async (c) => {
    const name = c.req.param('name')
    const def = registry[name]
    if (!def) {
      return c.json(
        { error: `Unknown flag: ${name}`, code: 'FLAG_NOT_FOUND' },
        404,
      )
    }
    await store.delete(name)
    return c.json({ revertedTo: def.default }, 200)
  })

  router.get('/:name/evaluate', async (c) => {
    const name = c.req.param('name')
    const def = registry[name]
    if (!def) {
      return c.json(
        { error: `Unknown flag: ${name}`, code: 'FLAG_NOT_FOUND' },
        404,
      )
    }
    const userId = c.req.query('userId')
    const planRaw = c.req.query('plan')
    const plan: Plan | undefined =
      planRaw === 'free' || planRaw === 'pro' || planRaw === 'enterprise'
        ? planRaw
        : undefined
    const ctx: EvaluationContext = { userId, plan }
    const record = await store.get(name)
    const value = evaluate(name, def, record?.override ?? null, ctx)
    return c.json(
      {
        name,
        value,
        usingOverride: record !== null,
        ctx,
      },
      200,
    )
  })

  return router
}

/**
 * Build a fresh OpenFeature provider bound to the given registry/store.
 * Re-exported for app boot to share the same store across the admin
 * router and the request-path provider.
 */
export function createFlagsProvider(deps: FlagsAdminDeps): FlagsProvider {
  return new FlagsProvider({
    registry: deps.registry,
    store: deps.store,
    getNodeEnv: deps.getNodeEnv,
  })
}
