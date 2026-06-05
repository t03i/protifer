import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

import type { Config } from '../config/index.ts'

export interface AuthDeps {
  auth: Config['auth']
  cors: Config['cors']
  database: Config['database']
}

function trustedOriginsList(deps: AuthDeps): string[] {
  const declared = deps.auth.betterAuthTrustedOrigins
  const raw = declared.length > 0 ? declared : deps.cors.origins.join(',')
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function createAuth(deps: AuthDeps, database?: Pool) {
  return betterAuth({
    plugins: [apiKey({ rateLimit: { enabled: false } })],
    database: database ?? new Pool({ connectionString: deps.database.url }),
    secret: deps.auth.betterAuthSecret,
    baseURL: deps.auth.betterAuthBaseUrl,
    trustedOrigins: trustedOriginsList(deps),
    socialProviders: {
      github: {
        clientId: deps.auth.githubClientId,
        clientSecret: deps.auth.githubClientSecret,
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    user: {
      additionalFields: {
        plan: { type: 'string', required: false, defaultValue: 'free' },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
