import { apiKey } from '@better-auth/api-key'
import { readConfig, readSecretOptional } from '@protifer/shared'
import { getMigrations } from 'better-auth/db/migration'
import { Pool } from 'pg'

// migrate is a one-shot script that only needs DB + auth env. It does NOT
// call loadConfig() because that would fail-fast on triton/garage/model
// vars the migrate container intentionally doesn't ship.
const databaseUrl = readConfig('DATABASE_URL')
if (!databaseUrl) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const pool = new Pool({ connectionString: databaseUrl })

try {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations({
    database: pool,
    secret: readSecretOptional('BETTER_AUTH_SECRET') ?? 'placeholder',
    baseURL: readConfig('BETTER_AUTH_BASE_URL') ?? 'http://localhost:9090',
    socialProviders: {
      github: {
        clientId: readConfig('GITHUB_CLIENT_ID') ?? '',
        clientSecret: readSecretOptional('GITHUB_CLIENT_SECRET') ?? '',
      },
    },
    user: {
      additionalFields: {
        plan: { type: 'string', required: false, defaultValue: 'free' },
      },
    },
    plugins: [apiKey()],
  })

  if (toBeCreated.length === 0 && toBeAdded.length === 0) {
    console.log('Database is already up to date.')
  } else {
    console.log(
      `Running migrations: creating ${String(toBeCreated.length)} table(s), adding fields to ${String(toBeAdded.length)} table(s)…`,
    )
    await runMigrations()
    console.log('Migrations complete.')
  }

  // users.role column for /admin/* gate. better-auth does NOT own this column
  // (we are not using the admin plugin). Idempotent via pg_attribute existence
  // check. Table name is quoted "user" because better-auth uses the reserved
  // SQL word as its default table name.
  // Caveat: if better-auth was installed with a pluralized table name (e.g.,
  // "users"), change '"user"'::regclass → 'users'::regclass and ALTER TABLE
  // "user" → ALTER TABLE users. Run against a dev DB first.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = '"user"'::regclass AND attname = 'role' AND NOT attisdropped
      ) THEN
        ALTER TABLE "user" ADD COLUMN role text NOT NULL DEFAULT 'user';
        ALTER TABLE "user" ADD CONSTRAINT user_role_check CHECK (role IN ('user', 'admin'));
      END IF;
    END $$;
  `)
  console.log('[migrate] Phase 22: ensured users.role column (D-10).')
} finally {
  await pool.end()
}
