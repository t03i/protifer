import {
  configField,
  defineConfig,
  secretField,
  zBooleanString,
} from '@protifer/shared'
import {
  DEFAULT_RETRY_BASE_BACKOFF_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
} from '@protifer/triton-client'
import { z } from 'zod'

export const ConfigSchema = defineConfig({
  metrics: {
    port: configField({
      envName: 'METRICS_PORT',
      description: 'Port for the Prometheus metrics HTTP server.',
      type: z.coerce.number().int().min(1).max(65535),
      default: 9090,
    }),
    enabled: configField({
      envName: 'METRICS_ENABLED',
      description: 'Whether to serve the Prometheus metrics endpoint.',
      type: zBooleanString,
      default: true,
    }),
  },
  triton: {
    url: configField({
      envName: 'TRITON_URL',
      description: 'Triton gRPC endpoint (host:port).',
      type: z.string().min(1),
    }),
    deadlineMs: configField({
      envName: 'TRITON_DEADLINE_MS',
      description: 'Per-request Triton deadline in ms.',
      type: z.coerce.number().int().positive(),
      default: 90_000,
    }),
    maxInflightInfers: configField({
      envName: 'TRITON_MAX_INFLIGHT_INFERS',
      description:
        'Max concurrent in-flight Triton modelInfer calls per worker, shared across all jobs. Conservative default; tune up against observed Triton capacity.',
      type: z.coerce.number().int().positive(),
      default: 8,
    }),
    retryMaxAttempts: configField({
      envName: 'TRITON_RETRY_MAX_ATTEMPTS',
      description:
        'Total modelInfer attempts (incl. first) on transient transport errors. ≤1 disables retry.',
      type: z.coerce.number().int().positive(),
      default: DEFAULT_RETRY_MAX_ATTEMPTS,
    }),
    retryBaseBackoffMs: configField({
      envName: 'TRITON_RETRY_BASE_BACKOFF_MS',
      description:
        'Base backoff in ms for the jittered transient-retry schedule.',
      type: z.coerce.number().int().positive(),
      default: DEFAULT_RETRY_BASE_BACKOFF_MS,
    }),
  },
  redis: {
    host: configField({
      envName: 'REDIS_HOST',
      description: 'Redis hostname for BullMQ.',
      type: z.string().min(1),
    }),
    port: configField({
      envName: 'REDIS_PORT',
      description: 'Redis port.',
      type: z.coerce.number().int().min(1).max(65535),
      default: 6379,
    }),
    password: secretField({
      envName: 'REDIS_PASSWORD',
      description: 'Redis requirepass value.',
      type: z.string().min(1),
    }),
  },
  storage: {
    driver: configField({
      envName: 'STORAGE_DRIVER',
      description: 'Object-store backend: s3 (Garage) or filesystem.',
      type: z.enum(['s3', 'filesystem']),
      default: 's3' as const,
    }),
    path: configField({
      envName: 'STORAGE_PATH',
      description:
        'Filesystem object-store root (used when STORAGE_DRIVER=filesystem).',
      type: z.string().min(1),
      default: '/data/objects',
    }),
    endpoint: configField({
      envName: 'GARAGE_ENDPOINT',
      description: 'Garage S3 endpoint URL.',
      type: z.url(),
    }),
    region: configField({
      envName: 'GARAGE_REGION',
      description: 'Garage S3 region.',
      type: z.string().min(1),
    }),
    bucket: configField({
      envName: 'GARAGE_BUCKET',
      description: 'Garage bucket holding prediction results.',
      type: z.string().min(1),
    }),
    accessKeyId: secretField({
      envName: 'GARAGE_ACCESS_KEY_ID',
      description: 'Garage S3 access key.',
      type: z.string().min(1),
    }),
    secretAccessKey: secretField({
      envName: 'GARAGE_SECRET_ACCESS_KEY',
      description: 'Garage S3 secret key.',
      type: z.string().min(1),
    }),
  },
})

export type Config = ReturnType<typeof ConfigSchema.load>

export function loadConfig(envIn: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.load(envIn)
}
