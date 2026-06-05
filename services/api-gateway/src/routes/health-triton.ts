import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

import { DEFAULT_TIMEOUT_MS, withTimeout } from './_utils.ts'

const tritonHealthRoute = createRoute({
  method: 'get',
  path: '/',
  security: [],
  hide: true,
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('ok') }),
        },
      },
      description: 'Triton is ready',
    },
    503: {
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('down') }),
        },
      },
      description: 'Triton is not ready or unreachable',
    },
  },
})

export function createHealthTritonRouter(options: {
  triton: () => Promise<boolean>
  timeoutMs?: number
}): OpenAPIHono {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const router = new OpenAPIHono()
  router.openapi(tritonHealthRoute, async (c) => {
    try {
      const ready = await withTimeout(options.triton(), timeoutMs)
      if (ready) return c.json({ status: 'ok' as const }, 200)
      return c.json({ status: 'down' as const }, 503)
    } catch {
      return c.json({ status: 'down' as const }, 503)
    }
  })
  return router
}
