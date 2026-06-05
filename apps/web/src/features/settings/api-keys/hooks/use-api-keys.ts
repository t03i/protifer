import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authClient } from '#/services/auth/client'

export interface ApiKeySummary {
  id: string
  name: string | null
  start: string | null
  prefix: string | null
  createdAt: string
  expiresAt: string | null
  lastRequest: string | null
  enabled: boolean
  /**
   * Owner email, if the backend response includes it. When present, we use it
   * to strip machine-user keys (`@protifer.invalid` suffix) as defence-in-depth
   * on top of better-auth's session-scoped list query.
   */
  ownerEmail?: string | null
}

const API_KEYS_QUERY_KEY = ['api-keys'] as const
const MACHINE_USER_EMAIL_SUFFIX = '@protifer.invalid'

export function isMachineUserKey(key: ApiKeySummary): boolean {
  return (
    typeof key.ownerEmail === 'string' &&
    key.ownerEmail.endsWith(MACHINE_USER_EMAIL_SUFFIX)
  )
}

export function useApiKeys() {
  return useQuery({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: async (): Promise<ApiKeySummary[]> => {
      const res = await authClient.apiKey.list()
      if (res.error) {
        throw new Error(res.error.message ?? 'Failed to load API keys')
      }
      const data = res.data as unknown as
        | ApiKeySummary[]
        | { apiKeys: ApiKeySummary[]; total: number }
      const keys = Array.isArray(data) ? data : data.apiKeys
      return keys.filter((k) => !isMachineUserKey(k))
    },
  })
}

export interface CreateKeyInput {
  name: string
  expiresInDays: number | null
}

export interface CreatedKey {
  id: string
  key: string
  name: string | null
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateKeyInput): Promise<CreatedKey> => {
      const res = await authClient.apiKey.create({
        name: input.name,
        ...(input.expiresInDays !== null
          ? { expiresIn: input.expiresInDays * 24 * 60 * 60 }
          : {}),
      })
      if (res.error) {
        throw new Error(res.error.message ?? 'Failed to create API key')
      }
      return res.data as unknown as CreatedKey
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY }),
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (keyId: string): Promise<void> => {
      const res = await authClient.apiKey.delete({ keyId })
      if (res.error) {
        throw new Error(res.error.message ?? 'Failed to revoke API key')
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY }),
  })
}
