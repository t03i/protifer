import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

/**
 * Liveness probe.
 *
 * Intentionally returns 200 unconditionally: if this handler is answering,
 * the event loop is running and the process isn't deadlocked — that's what
 * k8s/compose liveness probes need to decide whether to restart a container.
 *
 * Dependency-aware checks live in `/ready` (readiness). Liveness MUST NOT
 * depend on external systems — a Redis blip would otherwise crash-loop the
 * whole pod instead of just pulling it out of the service endpoints.
 *
 * `sha` is the build SHA (a startup constant — no dependency, no failure mode).
 * It rides liveness rather than a dedicated `/version` route because `/health`
 * is already in the public Caddy proxy allowlist, so the frontend can read it
 * and detect frontend/backend version skew without a deploy-repo change.
 */

const healthRoute = createRoute({
  method: 'get',
  path: '/',
  security: [],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('ok'),
            timestamp: z.string(),
            sha: z.string(),
          }),
        },
      },
      description: 'Service liveness check (process is up)',
    },
  },
})

export function createHealthRouter(options: { sha: string }) {
  const router = new OpenAPIHono()
  router.openapi(healthRoute, (c) =>
    c.json({
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
      sha: options.sha,
    }),
  )
  return router
}
