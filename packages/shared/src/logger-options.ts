import type pino from 'pino'

import { pinoCorrelationMixin } from './correlation.ts'

/** Default Pino options used by every service. Merge with `{ name }` at construction. */
export function defaultPinoOptions(): pino.LoggerOptions {
  return {
    level: process.env['LOG_LEVEL'] ?? 'info',
    mixin: pinoCorrelationMixin(),
    // PII/credential safety net: banned-category keys are censored at top
    // level and one level nested even if a call site logs them by accident.
    redact: {
      paths: [
        'email',
        '*.email',
        'authorization',
        '*.authorization',
        'ip',
        '*.ip',
      ],
    },
    ...(process.env['NODE_ENV'] !== 'production'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  }
}

export type { Logger } from 'pino'
