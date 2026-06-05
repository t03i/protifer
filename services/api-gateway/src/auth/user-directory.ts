import { Pool } from 'pg'

export interface UserRecord {
  id: string
  email: string
  plan?: string
  role?: string
}

export interface UserDirectory {
  getUser(id: string): Promise<UserRecord | null>
  close(): Promise<void>
}

export function createUserDirectory(pool: Pool): UserDirectory {
  return {
    async getUser(id) {
      const r = await pool.query<UserRecord>(
        'SELECT id, email, plan, role FROM "user" WHERE id = $1 LIMIT 1',
        [id],
      )
      return r.rows[0] ?? null
    },
    // The pool is owned by the caller (createApp) — close() is a no-op so
    // the directory's lifecycle stays decoupled from the shared pool's.
    close: () => Promise.resolve(),
  }
}
