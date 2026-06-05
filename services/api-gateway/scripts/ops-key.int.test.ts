/**
 * ops-key integration tests — hit a real Postgres (via testcontainers) and
 * exercise the full create → verify → rotate → revoke lifecycle through the
 * same entry points the CLI uses.
 */

import { apiKey } from '@better-auth/api-key'
import { getMigrations } from 'better-auth/db/migration'
import { Pool } from 'pg'
import { GenericContainer, Wait } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  MACHINE_USER_DOMAIN,
  runCreate,
  runList,
  runRevoke,
  runRotate,
} from './ops-key.ts'
import { createAuth } from '../src/auth/index.ts'
import type { AuthDeps } from '../src/auth/index.ts'
import { TEST_ENV, ConfigSchema } from '../src/config/schema.ts'

const DB_USER = 'postgres'
const DB_PASSWORD = 'postgres'
const DB_NAME = 'ops_key_test'

let container: StartedTestContainer
let databaseUrl: string
let pool: Pool

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: DB_USER,
      POSTGRES_PASSWORD: DB_PASSWORD,
      POSTGRES_DB: DB_NAME,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start()

  const host = container.getHost()
  const port = container.getMappedPort(5432)
  databaseUrl = `postgres://${DB_USER}:${DB_PASSWORD}@${host}:${String(port)}/${DB_NAME}`

  // createAuth() reads DATABASE_URL lazily at call time; our runCreate etc.
  // build their own pg Pool from the same env var.
  process.env['DATABASE_URL'] = databaseUrl
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-not-for-production'
  process.env['BETTER_AUTH_BASE_URL'] = 'http://localhost:9090'

  const migrationPool = new Pool({ connectionString: databaseUrl })
  try {
    const { runMigrations } = await getMigrations({
      database: migrationPool,
      secret: process.env['BETTER_AUTH_SECRET'],
      baseURL: process.env['BETTER_AUTH_BASE_URL'] ?? 'http://localhost:9090',
      user: {
        additionalFields: {
          plan: { type: 'string', required: false, defaultValue: 'free' },
        },
      },
      plugins: [apiKey()],
    })
    await runMigrations()
    // role column is added outside better-auth; mirror migrate.ts here so the
    // schema stays in parity (not used by ops-key itself).
    await migrationPool.query(`
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
    `)
  } finally {
    await migrationPool.end()
  }

  pool = new Pool({ connectionString: databaseUrl })
}, 300_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
}, 60_000)

afterEach(async () => {
  // Wipe any machine-user rows left over from the test run.
  await pool.query(
    `DELETE FROM apikey WHERE "referenceId" IN (SELECT id FROM "user" WHERE email LIKE '%' || $1)`,
    [MACHINE_USER_DOMAIN],
  )
  await pool.query(`DELETE FROM "user" WHERE email LIKE '%' || $1`, [
    MACHINE_USER_DOMAIN,
  ])
})

async function countMachineUsers(): Promise<number> {
  const r = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM "user" WHERE email LIKE '%' || $1`,
    [MACHINE_USER_DOMAIN],
  )
  return Number(r.rows[0]?.c ?? '0')
}

async function countKeysForLabel(label: string): Promise<number> {
  const r = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM apikey k
       JOIN "user" u ON u.id = k."referenceId"
      WHERE u.email = $1`,
    [`${label}${MACHINE_USER_DOMAIN}`],
  )
  return Number(r.rows[0]?.c ?? '0')
}

/** Capture everything the command writes to stdout/stderr. */
async function captureStdio<T>(fn: () => Promise<T>): Promise<{
  result: T
  stdout: string
  stderr: string
}> {
  const stdout: string[] = []
  const stderr: string[] = []
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      return true
    })
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
      )
      return true
    })
  try {
    const result = await fn()
    return { result, stdout: stdout.join(''), stderr: stderr.join('') }
  } finally {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  }
}

function authDepsForTest(): AuthDeps {
  const cfg = ConfigSchema.load({ ...TEST_ENV, DATABASE_URL: databaseUrl })
  return { auth: cfg.auth, cors: cfg.cors, database: cfg.database }
}

async function verify(rawKey: string): Promise<boolean> {
  // Share the caller's pool so we don't leak a second pg Pool per test run —
  // same singleton runCreate/runRotate use via getAuth(pool).
  const auth = createAuth(authDepsForTest(), pool)
  const res = await auth.api.verifyApiKey({ body: { key: rawKey } })
  return res.valid
}

describe('runCreate', () => {
  it('provisions user + key and mints a verifiable secret', async () => {
    const { stdout, stderr } = await captureStdio(() =>
      runCreate(pool, {
        label: 'ci-smoke-pro',
        plan: 'pro',
        expiresInDays: null,
      }),
    )

    const rawKey = stdout.trim()
    expect(rawKey).not.toBe('')
    expect(rawKey.split('\n')).toHaveLength(1)
    expect(stderr).toContain('created label=ci-smoke-pro')
    expect(await verify(rawKey)).toBe(true)
    expect(await countMachineUsers()).toBe(1)
    expect(await countKeysForLabel('ci-smoke-pro')).toBe(1)

    const userRow = await pool.query<{ plan: string; name: string }>(
      `SELECT plan, name FROM "user" WHERE email = $1`,
      [`ci-smoke-pro${MACHINE_USER_DOMAIN}`],
    )
    expect(userRow.rows[0]?.plan).toBe('pro')
    expect(userRow.rows[0]?.name).toBe('Machine: ci-smoke-pro')
  })

  it('errors on the second create with the same label and leaves state unchanged', async () => {
    await captureStdio(() =>
      runCreate(pool, { label: 'ci-dup', plan: 'pro', expiresInDays: null }),
    )

    await expect(
      captureStdio(() =>
        runCreate(pool, { label: 'ci-dup', plan: 'pro', expiresInDays: null }),
      ),
    ).rejects.toThrow(/already exists/)

    expect(await countMachineUsers()).toBe(1)
    expect(await countKeysForLabel('ci-dup')).toBe(1)
  })

  it('plumbs --plan through to user.plan', async () => {
    await captureStdio(() =>
      runCreate(pool, {
        label: 'ci-enterprise',
        plan: 'enterprise',
        expiresInDays: null,
      }),
    )
    const row = await pool.query<{ plan: string }>(
      `SELECT plan FROM "user" WHERE email = $1`,
      [`ci-enterprise${MACHINE_USER_DOMAIN}`],
    )
    expect(row.rows[0]?.plan).toBe('enterprise')
  })
})

describe('runRotate', () => {
  it('replaces the key, preserves the user row and plan, and invalidates the old key', async () => {
    const { stdout: firstOut } = await captureStdio(() =>
      runCreate(pool, { label: 'ci-rotate', plan: 'pro', expiresInDays: null }),
    )
    const oldKey = firstOut.trim()
    const before = await pool.query<{ id: string; plan: string }>(
      `SELECT id, plan FROM "user" WHERE email = $1`,
      [`ci-rotate${MACHINE_USER_DOMAIN}`],
    )

    const { stdout: rotatedOut, stderr } = await captureStdio(() =>
      runRotate(pool, { label: 'ci-rotate' }),
    )
    const newKey = rotatedOut.trim()

    expect(newKey).not.toBe('')
    expect(newKey).not.toBe(oldKey)
    expect(stderr).toContain('rotated label=ci-rotate')

    const after = await pool.query<{ id: string; plan: string }>(
      `SELECT id, plan FROM "user" WHERE email = $1`,
      [`ci-rotate${MACHINE_USER_DOMAIN}`],
    )
    expect(after.rows[0]?.id).toBe(before.rows[0]?.id)
    expect(after.rows[0]?.plan).toBe('pro')

    expect(await countKeysForLabel('ci-rotate')).toBe(1)
    expect(await verify(newKey)).toBe(true)
    expect(await verify(oldKey)).toBe(false)
  })

  it('errors on unknown label without mutating the DB', async () => {
    const before = await countMachineUsers()
    await expect(
      captureStdio(() => runRotate(pool, { label: 'does-not-exist' })),
    ).rejects.toThrow(/does not exist; use 'create'/)
    expect(await countMachineUsers()).toBe(before)
  })
})

describe('runRevoke', () => {
  it('removes both the user row and the key row, idempotent re-run errors', async () => {
    await captureStdio(() =>
      runCreate(pool, { label: 'ci-revoke', plan: 'pro', expiresInDays: null }),
    )
    expect(await countMachineUsers()).toBe(1)

    const { stdout, stderr } = await captureStdio(() =>
      runRevoke(pool, { label: 'ci-revoke' }),
    )
    expect(stdout).toBe('')
    expect(stderr).toContain('revoked label=ci-revoke')
    expect(await countMachineUsers()).toBe(0)
    expect(await countKeysForLabel('ci-revoke')).toBe(0)

    await expect(
      captureStdio(() => runRevoke(pool, { label: 'ci-revoke' })),
    ).rejects.toThrow(/nothing to revoke/)
  })

  it('refuses to delete a user whose email does not end in @protifer.invalid', async () => {
    // Hand-inject a user with the right email-local-part but a different
    // suffix, then point the script at the *right* label. runRevoke looks up
    // by `<label>@protifer.invalid`, so this confirms the label-to-row mapping
    // is tight — the hand-injected row must NOT be deleted.
    const humanEmail = 'ci-safety@example.com'
    await pool.query(
      `INSERT INTO "user" (id, email, "emailVerified", name, plan, "createdAt", "updatedAt")
       VALUES ($1, $2, TRUE, $3, 'pro', NOW(), NOW())`,
      [crypto.randomUUID(), humanEmail, 'Someone'],
    )

    await expect(
      captureStdio(() => runRevoke(pool, { label: 'ci-safety' })),
    ).rejects.toThrow(/does not exist; nothing to revoke/)

    const stillThere = await pool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE email = $1`,
      [humanEmail],
    )
    expect(stillThere.rowCount).toBe(1)

    // clean up the injected row so afterEach's @protifer.invalid wipe suffices.
    await pool.query(`DELETE FROM "user" WHERE email = $1`, [humanEmail])
  })
})

describe('runList', () => {
  it('emits a single header row + row per machine identity, nothing to stdout', async () => {
    await captureStdio(() =>
      runCreate(pool, { label: 'list-a', plan: 'free', expiresInDays: null }),
    )
    await captureStdio(() =>
      runCreate(pool, { label: 'list-b', plan: 'pro', expiresInDays: null }),
    )

    const { stdout, stderr } = await captureStdio(() => runList(pool))
    expect(stdout).toBe('')
    expect(stderr).toContain('LABEL')
    expect(stderr).toContain('list-a')
    expect(stderr).toContain('list-b')
    expect(stderr).toContain('free')
    expect(stderr).toContain('pro')
  })
})
