import {
  configField,
  customSection,
  defineConfig,
  loadSheddingConfig,
  secretField,
  zBooleanString,
  zCsv,
} from '@protifer/shared'
import { z } from 'zod'

const DEV_GARAGE_RPC_SECRET =
  '0000000000000000000000000000000000000000000000000000000000000000'
const DEV_GARAGE_ADMIN_TOKEN = 'dev-admin-token'

const NodeEnv = z.enum(['development', 'production', 'test'])

const env = {
  nodeEnv: configField({
    envName: 'NODE_ENV',
    description:
      'Runtime environment selector. Production triggers fail-fast checks.',
    type: NodeEnv,
    default: 'development' as const,
  }),
  port: configField({
    envName: 'PORT',
    description: 'HTTP listen port for the API gateway.',
    type: z.coerce.number().int().min(1).max(65535),
    default: 3001,
  }),
}

const auth = {
  betterAuthSecret: secretField({
    envName: 'BETTER_AUTH_SECRET',
    description:
      'better-auth signing secret (32-byte hex). openssl rand -hex 32.',
    type: z.string().min(16),
  }),
  betterAuthBaseUrl: configField({
    envName: 'BETTER_AUTH_BASE_URL',
    description:
      'Public base URL where better-auth is served. Must be HTTPS in production.',
    type: z.url(),
  }),
  betterAuthTrustedOrigins: configField({
    envName: 'BETTER_AUTH_TRUSTED_ORIGINS',
    description:
      'Comma-separated origins better-auth treats as trusted (supports glob). Empty = none.',
    type: z.string(),
    default: '',
  }),
  githubClientId: configField({
    envName: 'GITHUB_CLIENT_ID',
    description: 'GitHub OAuth app client ID.',
    type: z.string().min(1),
  }),
  githubClientSecret: secretField({
    envName: 'GITHUB_CLIENT_SECRET',
    description: 'GitHub OAuth app client secret.',
    type: z.string().min(1),
  }),
}

const database = {
  url: configField({
    envName: 'DATABASE_URL',
    description: 'Postgres connection string for the gateway and migrations.',
    type: z.url(),
  }),
}

const cors = {
  origins: configField({
    envName: 'CORS_ORIGINS',
    description:
      'Comma-separated list of allowed CORS origins (supports glob wildcards).',
    type: zCsv.refine((v) => v.length > 0, 'at least one origin is required'),
  }),
}

const redis = {
  host: configField({
    envName: 'REDIS_HOST',
    description: 'Redis hostname (BullMQ queues, rate limits, shedding state).',
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
    description:
      'Redis requirepass value (matches REDIS_PASSWORD in the compose stack).',
    type: z.string().min(1),
  }),
}

const triton = {
  url: configField({
    envName: 'TRITON_URL',
    description: 'Triton gRPC endpoint (host:port) used by the gateway.',
    type: z.string().min(1),
  }),
}

const storage = {
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
  garageEndpoint: configField({
    envName: 'GARAGE_ENDPOINT',
    description: 'Garage S3 endpoint URL.',
    type: z.url(),
  }),
  garageRegion: configField({
    envName: 'GARAGE_REGION',
    description: 'Garage S3 region (matches Garage cluster config).',
    type: z.string().min(1),
  }),
  garageBucket: configField({
    envName: 'GARAGE_BUCKET',
    description: 'Garage bucket holding embeddings and prediction results.',
    type: z.string().min(1),
  }),
  garageAccessKeyId: secretField({
    envName: 'GARAGE_ACCESS_KEY_ID',
    description: 'S3-style access key for the gateway-facing Garage bucket.',
    type: z.string().min(1),
  }),
  garageSecretAccessKey: secretField({
    envName: 'GARAGE_SECRET_ACCESS_KEY',
    description: 'S3-style secret key for the gateway-facing Garage bucket.',
    type: z.string().min(1),
  }),
  garageRpcSecret: secretField({
    envName: 'GARAGE_RPC_SECRET',
    description: 'Garage cluster RPC secret (64-hex). openssl rand -hex 32.',
    type: z.string().min(1),
  }),
  garageAdminToken: secretField({
    envName: 'GARAGE_ADMIN_TOKEN',
    description: 'Garage admin API token.',
    type: z.string().min(1),
  }),
}

const jobCleanup = {
  reconcileIntervalMs: configField({
    envName: 'JOB_CLEANUP_RECONCILE_INTERVAL_MS',
    description:
      'active-jobs ZSET reconciliation interval in ms. 0 disables the loop.',
    type: z.coerce.number().int().min(0),
    default: 60_000,
  }),
  lockTtlMs: configField({
    envName: 'JOB_CLEANUP_LOCK_TTL_MS',
    description: 'Leader lock TTL for the reconciliation loop.',
    type: z.coerce.number().int().min(1000),
    default: 30_000,
  }),
  staleChildrenThresholdMs: configField({
    envName: 'JOB_STALE_CHILDREN_THRESHOLD_MS',
    description:
      'Age beyond which a waiting-children prediction job counts as stale (observe-only gauge; nothing is killed). Tunes alert sensitivity.',
    type: z.coerce.number().int().min(1000),
    default: 1_800_000,
  }),
}

const models = {
  version: configField({
    envName: 'MODELS_VERSION',
    description:
      'Release version tag for the model suite; namespaces the immutable result cache.',
    type: z.string().min(1),
    default: 'v1',
  }),
}

// `dev.overrideAuth` is a tripwire: no runtime code consumes it (the legacy
// header-based auth bypass it gated was removed). Declared so
// `assertProductionInvariants` fails the boot if `DEV_OVERRIDE_AUTH=true`
// against a prod build.
const dev = {
  overrideAuth: configField({
    envName: 'DEV_OVERRIDE_AUTH',
    description:
      'Retired bypass flag retained as a production tripwire. No runtime effect.',
    type: zBooleanString,
    default: false,
  }),
}

const SHEDDING_FIELDS: ReadonlyArray<{
  envName: string
  dotted: string
  description: string
}> = [
  {
    envName: 'SHED_ENABLED',
    dotted: 'enabled',
    description:
      'Master switch for the shedding controller. false = pass-through.',
  },
  {
    envName: 'SHED_MODE',
    dotted: 'mode',
    description: 'shadow records-but-admits; enforce returns 503 over SLO.',
  },
  {
    envName: 'SHED_ALPHA',
    dotted: 'alpha',
    description: 'EWMA smoothing factor [0..1].',
  },
  {
    envName: 'SHED_STALENESS_SECONDS',
    dotted: 'stalenessSeconds',
    description: 'Completion-stale threshold for UPSTREAM_DOWN.',
  },
  {
    envName: 'SHED_SLO_FREE_SECONDS',
    dotted: 'sloSeconds.free',
    description: 'Wait-time SLO above which free is shed.',
  },
  {
    envName: 'SHED_SLO_PRO_SECONDS',
    dotted: 'sloSeconds.pro',
    description: 'Wait-time SLO above which pro is shed.',
  },
  {
    envName: 'SHED_SLO_ENTERPRISE_SECONDS',
    dotted: 'sloSeconds.enterprise',
    description: '0 disables shedding for enterprise.',
  },
  {
    envName: 'SHED_INITIAL_RESIDUES_PER_SECOND',
    dotted: 'initialResiduesPerSecond',
    description: 'EWMA seed before the first completion.',
  },
  {
    envName: 'SHED_RETRY_JITTER_FRACTION',
    dotted: 'retryJitterFraction',
    description: '±half-fraction jitter on Retry-After.',
  },
  {
    envName: 'PLAN_PRIORITY_FREE',
    dotted: 'priority.free',
    description: 'BullMQ job priority for free (lower drained first).',
  },
  {
    envName: 'PLAN_PRIORITY_PRO',
    dotted: 'priority.pro',
    description: 'BullMQ job priority for pro.',
  },
  {
    envName: 'PLAN_PRIORITY_ENTERPRISE',
    dotted: 'priority.enterprise',
    description: 'BullMQ job priority for enterprise.',
  },
]

const sheddingSection = customSection({
  load: (envIn) => loadSheddingConfig(envIn),
  describe: () =>
    SHEDDING_FIELDS.map((f) => ({
      envName: f.envName,
      path: f.dotted.split('.'),
      kind: 'config' as const,
      description: f.description,
      hasDefault: true,
      defaultRepr: '(see SHEDDING_DEFAULTS)',
      typeRepr: 'mixed',
    })),
})

export const ConfigSchema = defineConfig({
  env,
  auth,
  database,
  cors,
  redis,
  triton,
  storage,
  jobCleanup,
  models,
  dev,
  shedding: sheddingSection,
})

export type Config = ReturnType<typeof ConfigSchema.load>

export class ProductionConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Refusing to start in production with insecure config:\n${issues
        .map((i) => `  • ${i}`)
        .join('\n')}`,
    )
    this.name = 'ProductionConfigError'
  }
}

/** Apply production-only safety checks against an already-loaded Config. */
export function assertProductionInvariants(cfg: Config): void {
  if (cfg.env.nodeEnv !== 'production') return

  const issues: string[] = []

  if (
    cfg.auth.betterAuthBaseUrl.includes('localhost') ||
    cfg.auth.betterAuthBaseUrl.includes('127.0.0.1')
  ) {
    issues.push(
      `BETTER_AUTH_BASE_URL="${cfg.auth.betterAuthBaseUrl}" contains a localhost address — set it to the public HTTPS URL`,
    )
  } else if (cfg.auth.betterAuthBaseUrl.startsWith('http://')) {
    issues.push(
      `BETTER_AUTH_BASE_URL="${cfg.auth.betterAuthBaseUrl}" is plain http — production requires https://`,
    )
  }

  for (const origin of cfg.cors.origins) {
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      issues.push(
        `CORS_ORIGINS contains "${origin}" — replace with the production frontend URL(s)`,
      )
    } else if (origin.startsWith('http://')) {
      issues.push(
        `CORS_ORIGINS contains "${origin}" — production requires https:// origins`,
      )
    }
  }

  if (cfg.storage.garageRpcSecret === DEV_GARAGE_RPC_SECRET) {
    issues.push(
      'GARAGE_RPC_SECRET is the dev placeholder — generate with: openssl rand -hex 32',
    )
  }

  if (cfg.storage.garageAdminToken === DEV_GARAGE_ADMIN_TOKEN) {
    issues.push(
      'GARAGE_ADMIN_TOKEN is the dev placeholder — set it to a strong random token',
    )
  }

  if (cfg.dev.overrideAuth) {
    issues.push('DEV_OVERRIDE_AUTH must not be true in production')
  }

  if (issues.length > 0) throw new ProductionConfigError(issues)
}

export function loadConfig(envIn: NodeJS.ProcessEnv = process.env): Config {
  const cfg = ConfigSchema.load(envIn)
  assertProductionInvariants(cfg)
  return cfg
}

export const TEST_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3001',
  BETTER_AUTH_SECRET: 'test-secret-not-for-production',
  BETTER_AUTH_BASE_URL: 'http://localhost:9090',
  GITHUB_CLIENT_ID: 'test-gh-id',
  GITHUB_CLIENT_SECRET: 'test-gh-secret',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  CORS_ORIGINS: 'http://localhost:5173',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: 'test-redispw',
  TRITON_URL: 'localhost:8001',
  GARAGE_ENDPOINT: 'http://localhost:3900',
  GARAGE_REGION: 'garage',
  GARAGE_BUCKET: 'protifer-test',
  GARAGE_ACCESS_KEY_ID: 'test-ak',
  GARAGE_SECRET_ACCESS_KEY: 'test-sk',
  GARAGE_RPC_SECRET: 'a'.repeat(64),
  GARAGE_ADMIN_TOKEN: 'test-admin-token',
}

export function makeTestConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return ConfigSchema.load({ ...TEST_ENV, ...overrides })
}
