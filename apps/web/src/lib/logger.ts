import * as Sentry from '@sentry/react'

export interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (
    message: string,
    error?: unknown,
    context?: Record<string, unknown>,
  ) => void
}

class ConsoleLogger implements Logger {
  info(message: string, context?: Record<string, unknown>): void {
    console.info(`[INFO] ${message}`, context ?? '')
  }
  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[WARN] ${message}`, context ?? '')
  }
  error(
    message: string,
    error?: unknown,
    context?: Record<string, unknown>,
  ): void {
    console.error(`[ERROR] ${message}`, error ?? '', context ?? '')
  }
}

/**
 * Forwards `error()` to Sentry (keeping console output); `info`/`warn` stay
 * console-only. Wired in at boot via `setLogger` only when a DSN is configured,
 * so dev/test keep the plain `ConsoleLogger`.
 */
class SentryLogger extends ConsoleLogger {
  override error(
    message: string,
    error?: unknown,
    context?: Record<string, unknown>,
  ): void {
    super.error(message, error, context)
    Sentry.captureException(error ?? new Error(message), { extra: context })
  }
}

let _impl: Logger = new ConsoleLogger()

export function makeSentryLogger(): Logger {
  return new SentryLogger()
}

export function setLogger(impl: Logger): void {
  _impl = impl
}

export const logger: Logger = {
  info: (msg, ctx) => _impl.info(msg, ctx),
  warn: (msg, ctx) => _impl.warn(msg, ctx),
  error: (msg, err, ctx) => _impl.error(msg, err, ctx),
}
