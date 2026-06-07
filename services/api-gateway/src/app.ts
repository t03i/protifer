import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import { OpenFeature } from '@openfeature/server-sdk'
import type {
  AuthContext,
  FlagOverrideStore,
  Logger,
  ObjectStore,
  PredictionSuiteConfig,
  Redis,
} from '@protifer/shared'
import {
  AppError,
  CachedFlagOverrideStore,
  FLAG_REGISTRY,
  QUEUE_NAMES,
  QueueEvents,
  RedisFlagOverrideStore,
  createFlowProducer,
  defaultPinoOptions,
  createQueue,
  createRedisConnection,
  computeEmbeddingJobId,
  computePredictionJobId,
  getCorrelation,
} from '@protifer/shared'
import { createTritonClient } from '@protifer/triton-client'
import * as Sentry from '@sentry/node'
import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import { Pool } from 'pg'
import pino from 'pino'

import { createBullBoardRouter } from './admin/bull-board.ts'
import { createCleanupAdminRouter } from './admin/cleanup.ts'
import { createFlagsAdminRouter, createFlagsProvider } from './admin/flags.ts'
import { createSheddingAdminRouter } from './admin/shedding.ts'
import { createAuth } from './auth/index.ts'
import { createUserDirectory } from './auth/user-directory.ts'
import type { CleanupHandle } from './cleanup.ts'
import { setupJobCleanup } from './cleanup.ts'
import type { Config } from './config/index.ts'
import { loadConfig } from './config/index.ts'
import { resolveSuiteFromConfig } from './config/suites.ts'
import {
  createPrometheusFlagHook,
  createSentryFlagHook,
} from './flags/hooks.ts'
import { createMetrics, startQueueDepthPolling } from './metrics.ts'
import { createAdminRoleMiddleware } from './middleware/admin-role.ts'
import { createAuthenticateMiddleware } from './middleware/auth/index.ts'
import { createMetricsMiddleware } from './middleware/metrics.ts'
import {
  createSubmissionRateLimiter,
  createPollRateLimiter,
} from './middleware/rate-limit.ts'
import { createRequestContextMiddleware } from './middleware/request-context.ts'
import { createSheddingMiddleware } from './middleware/shedding.ts'
import { createUserContextMiddleware } from './middleware/user-context.ts'
import {
  attachPipelineMetrics,
  createStaleChildrenScan,
} from './pipeline-metrics.ts'
import { DbPlanResolver } from './plan/index.ts'
import type { RedisCommands } from './queue.ts'
import { createEmbeddingsRouter } from './routes/embeddings.ts'
import { createFlagsMeRouter } from './routes/flags-me.ts'
import { createFoldseekRouter } from './routes/foldseek.ts'
import { createHealthTritonRouter } from './routes/health-triton.ts'
import { createHealthRouter } from './routes/health.ts'
import { createPredictionsRouter } from './routes/predictions.ts'
import { createReadyRouter } from './routes/ready.ts'
import { startEventSubscriber } from './shedding/event-subscriber.ts'
import type { LeaderRedis } from './shedding/event-subscriber.ts'
import { createShedingState } from './shedding/state.ts'
import { createGatewayStore } from './storage.ts'
import type { Variables } from './types/hono.ts'

export function createRequestLogger(logger: Logger) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const start = Date.now()
    logger.info(
      { method: c.req.method, path: new URL(c.req.url).pathname },
      '→ request',
    )
    await next()
    // Explicit props: this continuation runs outside the nested ALS frame
    // established downstream by user-context, so the mixin can't supply them.
    const auth = c.get('auth') as AuthContext | undefined
    logger.info(
      {
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        ms: Date.now() - start,
        ...(auth ? { userId: auth.sub, authMethod: auth.method } : {}),
      },
      '← response',
    )
  })
}

/**
 * Build an origin-matching callback for hono's `cors({ origin: ... })`.
 *
 * Accepts a comma-separated env value (whitespace trimmed; empty entries
 * dropped). Entries containing `*` are compiled to single-segment regex
 * (dots escaped; `*` → `[^.]+`) — this PREVENTS `evil.com.vercel.app` from
 * matching `https://*.vercel.app`. Entries without `*` match exactly.
 * Wildcards stay single-segment as a security invariant.
 */
export function buildOriginMatcher(
  corsOriginsCsv: string,
): (origin: string | undefined) => string | null {
  const entries = corsOriginsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const exact = new Set<string>()
  const patterns: RegExp[] = []
  for (const entry of entries) {
    if (entry.includes('*')) {
      const re =
        '^' + entry.replace(/[.]/g, '\\.').replace(/\*/g, '[^.]+') + '$'
      patterns.push(new RegExp(re))
    } else {
      exact.add(entry)
    }
  }

  return (origin) => {
    if (!origin) return null
    if (exact.has(origin)) return origin
    if (patterns.some((re) => re.test(origin))) return origin
    return null
  }
}

export function createApp(overrides?: {
  store?: ObjectStore
  connection?: ReturnType<typeof createRedisConnection>
  serveStatic?: (options: { root: string }) => MiddlewareHandler
  config?: Config
  suite?: PredictionSuiteConfig
}): { app: OpenAPIHono<{ Variables: Variables }>; close: () => Promise<void> } {
  const config = overrides?.config ?? loadConfig()
  const store = overrides?.store ?? createGatewayStore(config.storage)
  const connection =
    overrides?.connection ??
    createRedisConnection({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
    })
  const serveStatic = overrides?.serveStatic
  // Prod injects the OCI-derived suite; dev/tests fall back to the file source.
  const modelSuite = overrides?.suite ?? resolveSuiteFromConfig(config.models)
  const embeddingQueue = createQueue(QUEUE_NAMES.EMBEDDING, connection)
  const predictionQueue = createQueue(QUEUE_NAMES.PREDICTION, connection)
  const flowProducer = createFlowProducer(connection)
  const redis = connection as unknown as RedisCommands
  const logger = pino({ name: 'api-gateway', ...defaultPinoOptions() })

  const sheddingConfig = config.shedding
  const sheddingState = createShedingState({
    redis: redis as unknown as Parameters<
      typeof createShedingState
    >[0]['redis'],
    config: sheddingConfig,
  })

  const metrics = createMetrics()

  const flagsStore: FlagOverrideStore = new CachedFlagOverrideStore(
    new RedisFlagOverrideStore(
      connection as unknown as ConstructorParameters<
        typeof RedisFlagOverrideStore
      >[0],
    ),
    5_000,
  )
  OpenFeature.setProvider(
    createFlagsProvider({
      registry: FLAG_REGISTRY,
      store: flagsStore,
      getNodeEnv: () => config.env.nodeEnv,
    }),
  )
  OpenFeature.addHooks(
    createPrometheusFlagHook(metrics.featureFlagEvaluations),
    createSentryFlagHook(),
  )
  const flagsClient = OpenFeature.getClient()
  const sheddingFlags = {
    async isEnabled(ctx: { plan?: string }) {
      return flagsClient.getBooleanValue(
        'shedding.enabled',
        sheddingConfig.enabled,
        ctx,
      )
    },
    async isEnforce(ctx: { plan?: string }) {
      return flagsClient.getBooleanValue(
        'shedding.enforce',
        sheddingConfig.mode === 'enforce',
        ctx,
      )
    },
  }

  const sheddingEventHandle = startEventSubscriber({
    redis: redis as unknown as LeaderRedis,
    connection,
    embeddingQueue,
    state: sheddingState,
    logger,
  })
  const queueDepthPoller = startQueueDepthPolling(
    [embeddingQueue, predictionQueue],
    metrics.bullmqQueueJobs,
  )

  // Shared QueueEvents instances — job cleanup and pipeline metrics both
  // listen; the app owns their lifecycle (closed in `close()`).
  const predictionQueueEvents = new QueueEvents(QUEUE_NAMES.PREDICTION, {
    connection,
  })
  const embeddingQueueEvents = new QueueEvents(QUEUE_NAMES.EMBEDDING, {
    connection,
  })
  for (const events of [predictionQueueEvents, embeddingQueueEvents]) {
    events.on('error', (err: Error) => {
      logger.warn({ err }, 'QueueEvents error')
    })
  }
  attachPipelineMetrics({
    events: predictionQueueEvents,
    queue: predictionQueue,
    metrics,
  })
  attachPipelineMetrics({
    events: embeddingQueueEvents,
    queue: embeddingQueue,
    metrics,
  })

  const cleanupHandle: CleanupHandle = setupJobCleanup({
    redis,
    logger,
    predictionEvents: predictionQueueEvents,
    embeddingEvents: embeddingQueueEvents,
    predictionQueue,
    embeddingQueue,
    metrics,
    staleChildrenScan: createStaleChildrenScan({
      redis,
      waitingChildrenKey: predictionQueue.toKey('waiting-children'),
      metrics,
      thresholdMs: config.jobCleanup.staleChildrenThresholdMs,
    }),
    intervalMs: config.jobCleanup.reconcileIntervalMs,
    lockTtlMs: config.jobCleanup.lockTtlMs,
  })

  const tritonClient = createTritonClient(config.triton.url)

  const sharedPool = new Pool({ connectionString: config.database.url })
  const auth = createAuth(
    { auth: config.auth, cors: config.cors, database: config.database },
    sharedPool,
  )
  const userDirectory = createUserDirectory(sharedPool)
  const planResolver = new DbPlanResolver({
    logger,
    getUser: async (userId) => {
      const result = await sharedPool.query<{ plan?: string }>(
        'SELECT plan FROM "user" WHERE id = $1 LIMIT 1',
        [userId],
      )
      return result.rows[0] ?? null
    },
  })
  const rateLimitConnection = connection as unknown as Redis
  const submissionRL = createSubmissionRateLimiter({
    connection: rateLimitConnection,
  })
  const pollRL = createPollRateLimiter({ connection: rateLimitConnection })

  const app = new OpenAPIHono<{ Variables: Variables }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: result.error.issues[0]?.message ?? 'Validation error',
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
    },
  })

  const matchOrigin = buildOriginMatcher(config.cors.origins.join(','))

  app.use(
    '*',
    createRequestContextMiddleware({
      isEnabled: () =>
        flagsClient.getBooleanValue('correlation-context-enabled', true),
    }),
  )

  app.use(
    '*',
    cors({
      origin: matchOrigin,
      credentials: true,
      exposeHeaders: [
        'RateLimit',
        'RateLimit-Policy',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-RateLimit-Concurrent',
        'Retry-After',
      ],
    }),
  )

  app.use('*', createRequestLogger(logger))
  app.use('*', createMetricsMiddleware(metrics))

  const strictSecureHeaders = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
    strictTransportSecurity: false,
  })
  app.use(
    '*',
    createMiddleware<{ Variables: Variables }>(async (c, next) => {
      if (c.req.path === '/docs') {
        await next()
        return
      }
      await strictSecureHeaders(c, next)
    }),
  )

  // /metrics is intentionally NOT routed through Caddy (Caddyfile.prod only
  // proxies /api/auth/*, /v1/*, /health, /admin/*). Prometheus scrapes the
  // container directly on port 3001, keeping metrics off the public internet.
  app.get('/metrics', async (c) => {
    const body = await metrics.registry.metrics()
    return c.body(body, 200, {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    })
  })

  app.route('/health', createHealthRouter())
  app.route(
    '/health/triton',
    createHealthTritonRouter({ triton: () => tritonClient.serverReady() }),
  )

  // Readiness probe — verifies Redis + Postgres are reachable. Reuses the
  // shared pg Pool (closed in `close()`).
  app.route(
    '/ready',
    createReadyRouter({
      redis: async () => {
        const r = connection as unknown as { ping: () => Promise<string> }
        await r.ping()
      },
      postgres: async () => {
        await sharedPool.query('SELECT 1')
      },
    }),
  )

  app.use(
    '/admin/*',
    createAuthenticateMiddleware({
      auth,
      resolver: planResolver,
      userDirectory,
    }),
  )
  app.use('/admin/*', createUserContextMiddleware())
  app.use('/admin/*', createAdminRoleMiddleware())
  app.route('/admin/cleanup', createCleanupAdminRouter(cleanupHandle))
  app.route(
    '/admin/shedding',
    createSheddingAdminRouter({
      state: sheddingState,
      config: sheddingConfig,
    }),
  )
  app.route(
    '/admin/flags',
    createFlagsAdminRouter({ registry: FLAG_REGISTRY, store: flagsStore }),
  )
  if (serveStatic) {
    // Bull Board ships its own static asset bundle; only mount when the
    // serve-static helper is wired in.
    app.route(
      '/admin/queues',
      createBullBoardRouter([embeddingQueue, predictionQueue], serveStatic),
    )
  }

  app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
  })

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description:
      'API key issued via Settings → API Keys (or `auth.api.createApiKey` server-side). Send as `Authorization: Bearer <key>`.',
  })

  // Swagger UI and the raw OpenAPI spec leak full schema details, so they are
  // dev-only. In production we skip registering both routes entirely — requests
  // to `/docs` and `/openapi.json` fall through to the 404 handler.
  const isProduction = config.env.nodeEnv === 'production'
  if (!isProduction) {
    app.doc('/openapi.json', {
      openapi: '3.0.0',
      info: {
        title: 'protifer API',
        version: '1.0.0',
        description:
          'Two ways to authenticate:\n\n' +
          '- **Session cookie** — [sign in with GitHub](/api/auth/sign-in/github) in this browser; subsequent requests include the cookie automatically. Best for interactive use.\n' +
          '- **Bearer API key** — issue a key from `/settings/api-keys` and send `Authorization: Bearer <key>`. Best for programmatic / CI use.',
      },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    })
    // Swagger UI ships inline scripts/styles, so the strict global CSP
    // (`default-src 'none'`) breaks it. Override with a Swagger-friendly
    // policy scoped to `/docs` only.
    app.use(
      '/docs',
      secureHeaders({
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
        xFrameOptions: 'DENY',
        referrerPolicy: 'no-referrer',
        strictTransportSecurity: false,
      }),
    )
    app.get('/docs', swaggerUI({ url: '/openapi.json' }))

    // Convenience route to sign in with GitHub from Swagger UI. This is not part of the public API.
    app.get('/api/auth/sign-in/github', (c) =>
      c.html(
        `<html><body><script>
fetch('/api/auth/sign-in/social',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'github',callbackURL:'/docs'})})
.then(r=>r.json()).then(d=>window.location.href=d.url);
</script></body></html>`,
      ),
    )
  }

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  app.use(
    '/v1/*',
    createAuthenticateMiddleware({
      auth,
      resolver: planResolver,
      userDirectory,
    }),
  )
  app.use('/v1/*', createUserContextMiddleware())

  app.use('/v1/predictions', submissionRL)
  app.use('/v1/embeddings', submissionRL)
  app.use('/v1/foldseek', submissionRL)
  app.use('/v1/predictions/:jobId', pollRL)
  app.use('/v1/embeddings/:jobId', pollRL)

  // Admission middleware — mounted AFTER the rate limiter, BEFORE the route
  // handlers. The cache-hit short-circuit lives in the middleware (via the
  // `computeJobId` + `queue` hook), so repeat-submits are admitted free
  // without touching the EWMA or counters.
  const predictionAdmission = createSheddingMiddleware({
    config: sheddingConfig,
    state: sheddingState,
    metrics,
    logger,
    flags: sheddingFlags,
    getResidues: (body) =>
      (body as { sequence?: string }).sequence?.length ?? 0,
    computeJobId: (body) => {
      const seq = (body as { sequence?: string }).sequence
      return typeof seq === 'string' && seq.length > 0
        ? computePredictionJobId(
            seq,
            modelSuite.embeddingModel,
            modelSuite.predictionModels,
          )
        : undefined
    },
    queue: predictionQueue,
  })
  const embeddingAdmission = createSheddingMiddleware({
    config: sheddingConfig,
    state: sheddingState,
    flags: sheddingFlags,
    metrics,
    logger,
    getResidues: (body) =>
      (body as { sequence?: string }).sequence?.length ?? 0,
    computeJobId: (body) => {
      const seq = (body as { sequence?: string }).sequence
      return typeof seq === 'string' && seq.length > 0
        ? computeEmbeddingJobId(seq, modelSuite.embeddingModel)
        : undefined
    },
    queue: embeddingQueue,
  })

  app.use('/v1/predictions', predictionAdmission)
  app.use('/v1/embeddings', embeddingAdmission)

  const routerDeps = {
    embeddingQueue,
    predictionQueue,
    flowProducer,
    store,
    redis,
    suite: modelSuite,
    priority: sheddingConfig.priority,
  }

  app.route(
    '/v1/flags/me',
    createFlagsMeRouter({ registry: FLAG_REGISTRY, store: flagsStore }),
  )

  app.route('/v1/predictions', createPredictionsRouter(routerDeps))
  app.route(
    '/v1/embeddings',
    createEmbeddingsRouter({
      embeddingQueue,
      store,
      redis,
      suite: modelSuite,
      priority: sheddingConfig.priority,
    }),
  )
  app.route('/v1/foldseek', createFoldseekRouter())

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.retryAfter !== undefined) {
        // Normalize to integer seconds per RFC 9110 §10.2.3.
        const seconds = Math.max(0, Math.ceil(err.retryAfter))
        c.header('Retry-After', String(seconds))
      }
      return c.json(
        { error: err.message, code: err.code },
        err.statusCode as 400 | 401 | 404 | 429 | 500 | 503,
      )
    }
    // `auth` is declared on Hono Variables for typed routes but unauthenticated
    // paths (e.g. `/health`) never set it — runtime value can still be undefined.
    const auth = c.get('auth') as Variables['auth'] | undefined
    const corr = getCorrelation()
    Sentry.withScope((scope) => {
      if (auth) {
        scope.setUser({ id: auth.sub })
        scope.setTag('plan', auth.plan)
      }
      scope.setTag('http.method', c.req.method)
      scope.setTag('http.route', new URL(c.req.url).pathname)
      if (corr) {
        scope.setTag('request_id', corr.requestId)
        scope.setTag('trace_id', corr.traceId)
      }
      Sentry.captureException(err)
    })
    logger.error({ err }, 'Unhandled error')
    return c.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      500,
    )
  })

  async function close() {
    // Shutdown order: producers first (stop accepting new work), then Redis
    // connections, then DB pools last (BullMQ and HTTP may still use them
    // during drain).
    queueDepthPoller.stop()
    await sheddingEventHandle.close()
    await cleanupHandle.close()
    await predictionQueueEvents.close()
    await embeddingQueueEvents.close()
    await flowProducer.close()
    await embeddingQueue.close()
    await predictionQueue.close()
    await (connection as unknown as Redis).quit()
    // DB pool closed last — both BullMQ internals and in-flight HTTP handlers
    // may hold references until the queues above have fully drained.
    await sharedPool.end()
    tritonClient.close()
  }

  return { app, close }
}
