import { Hono } from 'hono'

import type { CleanupHandle } from '../cleanup.ts'
import type { Variables } from '../types/hono.ts'

export function createCleanupAdminRouter(handle: CleanupHandle) {
  const router = new Hono<{ Variables: Variables }>()
  router.post('/reconcile', async (c) => {
    const result = await handle.reconcileNow()
    return c.json(result, 200)
  })
  return router
}
