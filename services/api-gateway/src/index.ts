import {
  ConfigValidationError,
  defaultPinoOptions,
  initSentry,
} from '@protifer/shared'
import { serveStatic } from 'hono/bun'
import pino from 'pino'

import { createApp } from './app.ts'
import {
  loadConfig,
  loadSuiteForBoot,
  ProductionConfigError,
} from './config/index.ts'

initSentry('api-gateway')

let config
try {
  config = loadConfig()
} catch (err) {
  if (
    err instanceof ConfigValidationError ||
    err instanceof ProductionConfigError
  ) {
    console.error(`\nFatal: ${err.message}\n`)
    process.exit(1)
  }
  throw err
}

const logger = pino({ name: 'api-gateway', ...defaultPinoOptions() })

// Resolve the served suite from the artifact inventory before boot. Fails loud
// if the OCI config is unreachable — no stale fallback (Decision 3).
let suite: Awaited<ReturnType<typeof loadSuiteForBoot>>
try {
  suite = await loadSuiteForBoot(config.models)
} catch (err) {
  logger.error({ err }, 'failed to load model inventory at boot')
  process.exit(1)
}

const { app, close } = createApp({ serveStatic, config, suite })

const server = Bun.serve({
  port: config.env.port,
  fetch: app.fetch,
})

logger.info({ port: config.env.port }, 'API Gateway listening')

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutdown signal received — draining')

  // Stop accepting new HTTP connections immediately.
  await server.stop(true)

  // Grace timer: if closeAll hasn't returned in 15 s, force-exit.
  const timer = setTimeout(() => {
    logger.error('graceful shutdown timed out after 15 s — forcing exit')
    process.exit(1)
  }, 15_000)
  // Don't let the timer keep the process alive past its own exit call.
  timer.unref()

  try {
    await close()
    logger.info('graceful shutdown complete')
    process.exit(0)
  } catch (err) {
    logger.error({ err }, 'error during graceful shutdown')
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
