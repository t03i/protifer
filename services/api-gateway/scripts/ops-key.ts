/**
 * ops-key — operator CLI for machine-user API key lifecycle.
 *
 * Subcommands: `create`, `rotate`, `revoke`, `list`.
 *
 * A machine user is a row in the `"user"` table whose email ends in
 * `@protifer.invalid` (RFC 6761, cannot collide with real signups). Each label
 * maps to exactly one machine user and one owned API key. The `.invalid`
 * suffix is the load-bearing safety marker: every destructive path refuses to
 * touch a row whose email does not carry it.
 *
 * Stdout contract:
 *   - `create` and `rotate` emit exactly the raw key on stdout (pipeable).
 *   - `revoke` and `list` emit nothing on stdout.
 *   - Human-readable metadata always goes to stderr.
 */

import { ConfigValidationError, defaultPinoOptions } from '@protifer/shared'
import { Pool } from 'pg'
import type { PoolClient } from 'pg'
import pino from 'pino'

import { createAuth } from '../src/auth/index.ts'
import type { Auth, AuthDeps } from '../src/auth/index.ts'
import { loadOpsKeyConfig } from '../src/config/index.ts'

export const MACHINE_USER_DOMAIN = '@protifer.invalid'
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/
const PLANS = ['free', 'pro', 'enterprise'] as const
type Plan = (typeof PLANS)[number]

const SECONDS_PER_DAY = 24 * 60 * 60
const PG_UNIQUE_VIOLATION = '23505'

const logger = pino({ name: 'ops-key', ...defaultPinoOptions() })

type Subcommand = 'create' | 'rotate' | 'revoke' | 'list'

interface CreateArgs {
  label: string
  plan: Plan
  expiresInDays: number | null
}

interface LabelOnlyArgs {
  label: string
}

function usage(): string {
  return [
    'Usage:',
    '  bun run key create --label <label> [--plan free|pro|enterprise] [--expires-in-days N]',
    '  bun run key rotate --label <label>',
    '  bun run key revoke --label <label>',
    '  bun run key list',
    '',
    `Labels must match ${LABEL_RE.source} (DNS-label-safe).`,
  ].join('\n')
}

class OpsKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpsKeyError'
  }
}

function assertLabel(label: string): void {
  if (!LABEL_RE.test(label)) {
    throw new OpsKeyError(
      `invalid label '${label}': must match ${LABEL_RE.source}`,
    )
  }
}

function assertPlan(plan: string): asserts plan is Plan {
  if (!(PLANS as readonly string[]).includes(plan)) {
    throw new OpsKeyError(
      `invalid --plan '${plan}': must be one of ${PLANS.join('|')}`,
    )
  }
}

function parseCreate(rest: string[]): CreateArgs {
  let label: string | undefined
  let plan: Plan = 'pro'
  let expiresInDays: number | null = null

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--label') {
      const next = rest[++i]
      if (!next) throw new OpsKeyError('--label requires a value')
      label = next
    } else if (a === '--plan') {
      const next = rest[++i]
      if (!next) throw new OpsKeyError('--plan requires a value')
      assertPlan(next)
      plan = next
    } else if (a === '--expires-in-days') {
      const next = rest[++i]
      if (!next) throw new OpsKeyError('--expires-in-days requires a value')
      const n = Number(next)
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        throw new OpsKeyError(
          '--expires-in-days must be a positive integer number of days',
        )
      }
      expiresInDays = n
    } else {
      throw new OpsKeyError(`unknown flag for 'create': ${a ?? ''}`)
    }
  }

  if (!label) throw new OpsKeyError("'create' requires --label")
  assertLabel(label)
  return { label, plan, expiresInDays }
}

function parseLabelOnly(sub: Subcommand, rest: string[]): LabelOnlyArgs {
  let label: string | undefined

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--label') {
      const next = rest[++i]
      if (!next) throw new OpsKeyError('--label requires a value')
      label = next
    } else if (a === '--plan') {
      throw new OpsKeyError(
        `'${sub}' does not accept --plan; use 'revoke' + 'create' to change a machine user's plan`,
      )
    } else {
      throw new OpsKeyError(`unknown flag for '${sub}': ${a ?? ''}`)
    }
  }

  if (!label) throw new OpsKeyError(`'${sub}' requires --label`)
  assertLabel(label)
  return { label }
}

function emailFor(label: string): string {
  return `${label}${MACHINE_USER_DOMAIN}`
}

// Cached on first access — main() loads it once at boot and runCreate/runRotate
// (and the int-test direct callers) read from the cache via getCachedAuthDeps().
let cachedAuthDeps: AuthDeps | undefined

function loadOpsConfig(): { pool: Pool; authDeps: AuthDeps } {
  let cfg
  try {
    cfg = loadOpsKeyConfig()
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      throw new OpsKeyError(err.message)
    }
    throw err
  }
  const authDeps: AuthDeps = {
    auth: cfg.auth,
    cors: cfg.cors,
    database: cfg.database,
  }
  cachedAuthDeps = authDeps
  return {
    pool: new Pool({ connectionString: cfg.database.url }),
    authDeps,
  }
}

function getCachedAuthDeps(): AuthDeps {
  if (cachedAuthDeps) return cachedAuthDeps
  const { authDeps } = loadOpsConfig()
  return authDeps
}

interface UserRow {
  id: string
  email: string
  plan: string | null
}

interface KeyRow {
  id: string
  start: string | null
}

async function findMachineUser(
  client: Pick<PoolClient, 'query'>,
  label: string,
): Promise<UserRow | null> {
  const r = await client.query<UserRow>(
    'SELECT id, email, plan FROM "user" WHERE email = $1 LIMIT 1',
    [emailFor(label)],
  )
  return r.rows[0] ?? null
}

async function listKeysForUser(
  client: Pick<PoolClient, 'query'>,
  userId: string,
): Promise<KeyRow[]> {
  const r = await client.query<KeyRow>(
    'SELECT id, start FROM apikey WHERE "referenceId" = $1',
    [userId],
  )
  return r.rows
}

// One auth instance per process, backed by the caller's Pool. better-auth's
// adapter holds long-lived connections; if we called `createAuth()` from every
// subcommand we would accumulate a new pg Pool per call and leak connections
// (visible on CI as FATAL 57P01 when the test Postgres is torn down).
const authByPool = new WeakMap<Pool, Auth>()
function getAuth(pool: Pool): Auth {
  const cached = authByPool.get(pool)
  if (cached) return cached
  const auth = createAuth(getCachedAuthDeps(), pool)
  authByPool.set(pool, auth)
  return auth
}

export async function runCreate(pool: Pool, args: CreateArgs): Promise<void> {
  const auth = getAuth(pool)
  const email = emailFor(args.label)
  const client = await pool.connect()
  let userId: string | null = null

  try {
    await client.query('BEGIN')
    try {
      const generatedId = crypto.randomUUID()
      const insert = await client.query<{ id: string }>(
        `INSERT INTO "user" (id, email, "emailVerified", name, plan, "createdAt", "updatedAt")
         VALUES ($1, $2, TRUE, $3, $4, NOW(), NOW())
         RETURNING id`,
        [generatedId, email, `Machine: ${args.label}`, args.plan],
      )
      const inserted = insert.rows[0]
      if (!inserted) {
        throw new Error('user insert returned no row')
      }
      userId = inserted.id
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      if (isUniqueViolation(err)) {
        throw new OpsKeyError(
          `label '${args.label}' already exists; use 'rotate' to replace its key`,
        )
      }
      throw err
    }
  } finally {
    client.release()
  }

  // The better-auth apiKey plugin drives its own adapter; it cannot join our
  // pg transaction. We compensate on failure by deleting the user row we just
  // inserted, guarded by the @protifer.invalid suffix.
  try {
    const minted = await auth.api.createApiKey({
      body: {
        name: args.label,
        userId,
        ...(args.expiresInDays !== null
          ? { expiresIn: args.expiresInDays * SECONDS_PER_DAY }
          : {}),
      },
    })
    if (!minted.key) {
      throw new OpsKeyError(
        `auth.api.createApiKey returned no key for label '${args.label}'`,
      )
    }

    process.stderr.write(
      `created label=${args.label} id=${minted.id} prefix=${minted.start ?? '(none)'} userId=${userId} plan=${args.plan} expiresAt=${minted.expiresAt ? new Date(minted.expiresAt).toISOString() : 'never'}\n`,
    )
    process.stdout.write(minted.key)
    process.stdout.write('\n')

    logger.info(
      {
        action: 'create',
        label: args.label,
        prefix: minted.start,
        userId,
        plan: args.plan,
      },
      'machine-user key created',
    )
  } catch (err) {
    if (userId) await compensatingDeleteUser(pool, userId)
    throw err
  }
}

export async function runRotate(
  pool: Pool,
  args: LabelOnlyArgs,
): Promise<void> {
  const auth = getAuth(pool)
  const user = await findMachineUser(pool, args.label)
  if (!user) {
    throw new OpsKeyError(
      `label '${args.label}' does not exist; use 'create' to provision it`,
    )
  }
  assertMachineEmail(user.email)

  const priorKeys = await listKeysForUser(pool, user.id)
  const revokedPrefixes = priorKeys
    .map((k) => k.start)
    .filter((p): p is string => p !== null)

  // Mint first so the operator always ends with a working key even if the
  // delete-old-keys step races or fails.
  const minted = await auth.api.createApiKey({
    body: { name: args.label, userId: user.id },
  })
  if (!minted.key) {
    throw new OpsKeyError(
      `auth.api.createApiKey returned no key for label '${args.label}'`,
    )
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    try {
      if (priorKeys.length > 0) {
        const priorIds = priorKeys.map((k) => k.id)
        await client.query(
          'DELETE FROM apikey WHERE "referenceId" = $1 AND id = ANY($2::text[])',
          [user.id, priorIds],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } finally {
    client.release()
  }

  process.stderr.write(
    `rotated label=${args.label} newPrefix=${minted.start ?? '(none)'} userId=${user.id} revokedPrefixes=[${revokedPrefixes.join(', ')}]\n`,
  )
  process.stdout.write(minted.key)
  process.stdout.write('\n')

  logger.info(
    {
      action: 'rotate',
      label: args.label,
      newPrefix: minted.start,
      userId: user.id,
      revokedPrefixes,
    },
    'machine-user key rotated',
  )
}

export async function runRevoke(
  pool: Pool,
  args: LabelOnlyArgs,
): Promise<void> {
  const user = await findMachineUser(pool, args.label)
  if (!user) {
    throw new OpsKeyError(
      `label '${args.label}' does not exist; nothing to revoke`,
    )
  }
  assertMachineEmail(user.email)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    try {
      const priorKeys = await listKeysForUser(client, user.id)
      const revokedPrefixes = priorKeys
        .map((k) => k.start)
        .filter((p): p is string => p !== null)

      await client.query('DELETE FROM apikey WHERE "referenceId" = $1', [
        user.id,
      ])
      const del = await client.query(
        `DELETE FROM "user" WHERE id = $1 AND email LIKE '%' || $2`,
        [user.id, MACHINE_USER_DOMAIN],
      )
      if (del.rowCount !== 1) {
        throw new OpsKeyError(
          `expected to delete exactly 1 user row for label '${args.label}' (got ${String(del.rowCount ?? 0)}); concurrent modification suspected`,
        )
      }
      await client.query('COMMIT')

      process.stderr.write(
        `revoked label=${args.label}; user and ${String(priorKeys.length)} key(s) deleted\n`,
      )

      logger.info(
        {
          action: 'revoke',
          label: args.label,
          userId: user.id,
          revokedPrefixes,
        },
        'machine-user key revoked',
      )
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } finally {
    client.release()
  }
}

interface ListRow {
  email: string
  plan: string | null
  prefix: string | null
  createdAt: Date | null
  lastRequest: Date | null
  expiresAt: Date | null
}

export async function runList(pool: Pool): Promise<void> {
  const r = await pool.query<ListRow>(
    `SELECT u.email,
            u.plan,
            k.start AS prefix,
            k."createdAt" AS "createdAt",
            k."lastRequest" AS "lastRequest",
            k."expiresAt" AS "expiresAt"
       FROM "user" u
       LEFT JOIN apikey k ON k."referenceId" = u.id
      WHERE u.email LIKE '%' || $1
      ORDER BY u.email`,
    [MACHINE_USER_DOMAIN],
  )

  const rows = r.rows.map((row) => ({
    label: row.email.endsWith(MACHINE_USER_DOMAIN)
      ? row.email.slice(0, -MACHINE_USER_DOMAIN.length)
      : row.email,
    plan: row.plan ?? '-',
    prefix: row.prefix ?? '-',
    created: row.createdAt ? row.createdAt.toISOString() : '-',
    lastUsed: row.lastRequest ? row.lastRequest.toISOString() : '-',
    expires: row.expiresAt ? row.expiresAt.toISOString() : 'never',
  }))

  const headers = ['LABEL', 'PLAN', 'PREFIX', 'CREATED', 'LAST USED', 'EXPIRES']
  const keys = [
    'label',
    'plan',
    'prefix',
    'created',
    'lastUsed',
    'expires',
  ] as const
  const widths = headers.map((h, i) => {
    const key = keys[i] as (typeof keys)[number]
    return Math.max(h.length, ...rows.map((row) => row[key].length))
  })

  function renderRow(cells: string[]): string {
    return cells.map((c, i) => c.padEnd(widths[i] ?? 0, ' ')).join('  ')
  }

  process.stderr.write(renderRow(headers) + '\n')
  for (const row of rows) {
    process.stderr.write(renderRow(keys.map((k) => row[k])) + '\n')
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  )
}

function assertMachineEmail(email: string): void {
  if (!email.endsWith(MACHINE_USER_DOMAIN)) {
    throw new OpsKeyError(
      `safety violation: refusing to operate on user with email '${email}' (does not end in ${MACHINE_USER_DOMAIN})`,
    )
  }
}

async function compensatingDeleteUser(
  pool: Pool,
  userId: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM "user" WHERE id = $1 AND email LIKE '%' || $2`,
    [userId, MACHINE_USER_DOMAIN],
  )
}

export async function main(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv
  if (!sub) {
    process.stderr.write(usage() + '\n')
    process.exit(2)
  }

  const { pool } = loadOpsConfig()
  try {
    switch (sub) {
      case 'create': {
        await runCreate(pool, parseCreate(rest))
        return
      }
      case 'rotate': {
        await runRotate(pool, parseLabelOnly('rotate', rest))
        return
      }
      case 'revoke': {
        await runRevoke(pool, parseLabelOnly('revoke', rest))
        return
      }
      case 'list': {
        if (rest.length > 0) {
          throw new OpsKeyError("'list' does not take any flags")
        }
        await runList(pool)
        return
      }
      default: {
        process.stderr.write(`unknown subcommand '${sub}'\n${usage()}\n`)
        process.exit(2)
      }
    }
  } finally {
    await pool.end()
  }
}

// Guard against import from tests re-executing the CLI.
if (import.meta.main) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    if (err instanceof OpsKeyError) {
      process.stderr.write(`${err.message}\n`)
      process.exit(1)
    }
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    process.exit(1)
  })
}
