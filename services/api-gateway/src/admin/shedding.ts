import type { SheddingConfig } from '@protifer/shared'
import { Hono } from 'hono'

import type { SheddingState } from '../shedding/state.ts'
import type { Variables } from '../types/hono.ts'

export interface SheddingAdminDeps {
  state: SheddingState
  config: SheddingConfig
  clock?: { now: () => number }
}

export function createSheddingAdminRouter(deps: SheddingAdminDeps) {
  const { state, config } = deps
  const now = deps.clock?.now ?? Date.now
  const router = new Hono<{ Variables: Variables }>()

  router.get('/state', async (c) => {
    const snap = await state.readState()
    const throughput =
      snap.residuesPerSecondEwma > 0
        ? snap.residuesPerSecondEwma
        : config.initialResiduesPerSecond
    const estimatedWaitSeconds = snap.pendingResidues / throughput
    return c.json(
      {
        pendingResidues: snap.pendingResidues,
        residuesPerSecondEwma: snap.residuesPerSecondEwma,
        estimatedWaitSeconds,
        lastCompletionTimestamp:
          snap.lastCompletionTimestampMs !== null
            ? new Date(snap.lastCompletionTimestampMs).toISOString()
            : null,
        nowTimestamp: new Date(now()).toISOString(),
        mode: config.mode,
        enabled: config.enabled,
        slo: config.sloSeconds,
        priority: config.priority,
      },
      200,
    )
  })

  return router
}
