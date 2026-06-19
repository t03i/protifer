import type { AuthContext, Queue, SheddingConfig } from '@protifer/shared'
import { OverloadedError, UpstreamDownError } from '@protifer/shared'
import { createMiddleware } from 'hono/factory'
import type { Counter, Gauge } from 'prom-client'

import type { SheddingCode } from '../shedding/decide.ts'
import { decideAdmission } from '../shedding/decide.ts'
import type { SheddingState, SheddingStateSnapshot } from '../shedding/state.ts'
import type { Variables } from '../types/hono.ts'

export interface SheddingMetrics {
  requestsShedTotal: Counter<'mode' | 'plan' | 'outcome' | 'code'>
  shedingEstimatedWait: Gauge
  shedingResiduesPerSecond: Gauge
  shedingPendingResidues: Gauge
}

interface MiddlewareLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Resolves shedding's two control-plane flags. Both calls are async to
 * accommodate OpenFeature client semantics; in-process providers backed by
 * a 5s cache make the steady-state cost negligible. `enabled` and `enforce`
 * are evaluated per request so admin overrides take effect without restart.
 */
export interface SheddingFlags {
  isEnabled(ctx: { plan?: string }): Promise<boolean>
  isEnforce(ctx: { plan?: string }): Promise<boolean>
}

export interface SheddingMiddlewareDeps {
  config: SheddingConfig
  state: SheddingState
  metrics: SheddingMetrics
  logger: MiddlewareLogger
  /**
   * Extract the residue weight from the parsed request body. The middleware
   * reads the body once via `c.req.json()` (Hono caches the parse) before
   * the Zod validator runs in the route handler.
   */
  getResidues: (body: unknown) => number
  /**
   * If provided, returns the BullMQ job ID that the cache-hit short-circuit
   * in the handler will look up. When the job already exists and is not
   * failed, admission is skipped so cache hits pay no queue cost.
   */
  computeJobId?: (body: unknown) => string | undefined
  queue?: Queue
  clock?: { now: () => number }
  /**
   * Optional flags adapter. When omitted, the middleware reads the static
   * `config.enabled` and `config.mode === 'enforce'` (legacy env path).
   */
  flags?: SheddingFlags
}

export function createSheddingMiddleware(deps: SheddingMiddlewareDeps) {
  const {
    config,
    state,
    metrics,
    logger,
    getResidues,
    computeJobId,
    queue,
    flags,
  } = deps
  const now = deps.clock?.now ?? (() => Date.now())

  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined
    const enabled = flags
      ? await flags.isEnabled({ plan: auth?.plan })
      : config.enabled
    if (!enabled) {
      await next()
      return
    }

    if (!auth) {
      await next()
      return
    }

    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      // Invalid JSON will fail validation downstream; let the handler
      // surface that error rather than double-emitting from admission.
      await next()
      return
    }

    // Cache-hit short-circuit: if the hash-based job already exists and is
    // not in a terminal-failed state, bypass admission accounting so
    // repeat-submits don't inflate pendingResidues or trigger shed.
    if (computeJobId && queue) {
      try {
        const jobId = computeJobId(body)
        if (jobId) {
          const existing = await queue.getJob(jobId)
          if (existing) {
            const state = await existing.getState()
            if (state !== 'failed') {
              await next()
              return
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, 'shedding: cache-hit probe failed — continuing')
      }
    }

    const residues = Math.max(0, getResidues(body))

    let snapshot: SheddingStateSnapshot
    try {
      snapshot = await state.readState()
    } catch (err) {
      logger.warn({ err }, 'shedding: state read failed — admitting')
      await next()
      return
    }

    const decision = decideAdmission({
      state: snapshot,
      config,
      plan: auth.plan,
      sequenceResidues: residues,
      nowMs: now(),
    })

    metrics.shedingPendingResidues.set(snapshot.pendingResidues)
    metrics.shedingResiduesPerSecond.set(snapshot.residuesPerSecondEwma)
    metrics.shedingEstimatedWait.set(decision.estimatedWaitSeconds)

    const enforce = flags
      ? await flags.isEnforce({ plan: auth.plan })
      : config.mode === 'enforce'
    const mode = enforce ? 'enforce' : 'shadow'

    if (!decision.admit) {
      const code: SheddingCode = decision.code ?? 'OVERLOADED'
      metrics.requestsShedTotal.inc(
        { mode, plan: auth.plan, outcome: 'shed', code },
        1,
      )
      logger.info(
        {
          plan: auth.plan,
          code,
          estimatedWaitSeconds: decision.estimatedWaitSeconds,
          pendingResidues: snapshot.pendingResidues,
          residuesPerSecondEwma: snapshot.residuesPerSecondEwma,
          mode,
          residues,
        },
        enforce ? 'shedding: shed' : 'shedding: would shed (shadow)',
      )

      if (enforce) {
        if (code === 'UPSTREAM_DOWN') {
          throw new UpstreamDownError(
            'Upstream embedding backend is not responding',
            decision.retryAfterSeconds,
          )
        }
        throw new OverloadedError(
          'Service overloaded — try again shortly',
          decision.retryAfterSeconds,
        )
      }

      // shadow mode: admit despite decision
      try {
        await state.incrementPending(residues)
        await state.incrAdmitted(residues)
      } catch (err) {
        logger.warn({ err }, 'shedding: incrementPending failed (shadow)')
      }
      await next()
      return
    }

    metrics.requestsShedTotal.inc(
      { mode, plan: auth.plan, outcome: 'admit', code: '' },
      1,
    )
    try {
      await state.incrementPending(residues)
      await state.incrAdmitted(residues)
    } catch (err) {
      logger.warn({ err }, 'shedding: incrementPending failed')
    }
    await next()
  })
}
