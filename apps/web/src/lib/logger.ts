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

let _impl: Logger = new ConsoleLogger()

export function setLogger(impl: Logger): void {
  _impl = impl
}

export const logger: Logger = {
  info: (msg, ctx) => _impl.info(msg, ctx),
  warn: (msg, ctx) => _impl.warn(msg, ctx),
  error: (msg, err, ctx) => _impl.error(msg, err, ctx),
}
