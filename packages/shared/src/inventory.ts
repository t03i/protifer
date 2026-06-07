import { readFileSync } from 'fs'

import { z } from 'zod'

/** OCI config-blob mediaType carrying the model inventory (Decision 3). */
export const MODEL_INVENTORY_MEDIA_TYPE =
  'application/vnd.protifer.model-inventory.v1+json'

export const ModelRoleSchema = z.enum(['embedding', 'prediction', 'internal'])
export type ModelRole = z.infer<typeof ModelRoleSchema>

export const ModelInventoryEntrySchema = z
  .object({
    triton: z.string().min(1),
    id: z.string().min(1).optional(),
    role: ModelRoleSchema,
    version: z.string().min(1),
  })
  .refine((e) => e.role === 'internal' || e.id !== undefined, {
    message: 'embedding/prediction entries require an `id`',
  })
export type ModelInventoryEntry = z.infer<typeof ModelInventoryEntrySchema>

export const ModelInventorySchema = z.object({
  models: z.array(ModelInventoryEntrySchema).min(1),
})
export type ModelInventory = z.infer<typeof ModelInventorySchema>

export class ModelInventoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ModelInventoryError'
  }
}

export function parseModelInventory(raw: unknown): ModelInventory {
  const result = ModelInventorySchema.safeParse(raw)
  if (!result.success) {
    throw new ModelInventoryError(
      `invalid model inventory: ${result.error.message}`,
      { cause: result.error },
    )
  }
  return result.data
}

/** Dev source: read + validate the checked-in inventory file. */
export function loadModelInventoryFromFile(path: string): ModelInventory {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw new ModelInventoryError(
      `cannot read model inventory file at ${path}`,
      {
        cause: err,
      },
    )
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new ModelInventoryError(
      `model inventory file at ${path} is not valid JSON`,
      { cause: err },
    )
  }
  return parseModelInventory(json)
}

export interface OciRef {
  host: string
  repo: string
  reference: string
}

/** Parse `host/repo@sha256:…` or `host/repo:tag` (oci:// prefix tolerated). */
export function parseOciRef(ref: string): OciRef {
  const cleaned = ref.replace(/^oci:\/\//, '')
  const atIdx = cleaned.indexOf('@')
  let nameAndTag: string
  let reference: string
  if (atIdx !== -1) {
    nameAndTag = cleaned.slice(0, atIdx)
    reference = cleaned.slice(atIdx + 1)
  } else {
    const lastColon = cleaned.lastIndexOf(':')
    const lastSlash = cleaned.lastIndexOf('/')
    if (lastColon > lastSlash) {
      nameAndTag = cleaned.slice(0, lastColon)
      reference = cleaned.slice(lastColon + 1)
    } else {
      nameAndTag = cleaned
      reference = 'latest'
    }
  }
  const firstSlash = nameAndTag.indexOf('/')
  if (firstSlash === -1 || !reference) {
    throw new ModelInventoryError(`malformed OCI reference: ${ref}`)
  }
  return {
    host: nameAndTag.slice(0, firstSlash),
    repo: nameAndTag.slice(firstSlash + 1),
    reference,
  }
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

interface BearerChallenge {
  realm: string
  service?: string
  scope?: string
}

function parseBearerChallenge(header: string): BearerChallenge | null {
  const rest = /^Bearer\s+(.*)$/i.exec(header.trim())?.[1]
  if (!rest) return null
  const params: Record<string, string> = {}
  for (const part of rest.split(',')) {
    const kv = /^\s*([a-zA-Z]+)="([^"]*)"\s*$/.exec(part)
    if (kv?.[1] && kv[2] !== undefined) params[kv[1]] = kv[2]
  }
  if (!params.realm) return null
  return { realm: params.realm, service: params.service, scope: params.scope }
}

async function resolveToken(
  challenge: BearerChallenge,
  token: string | undefined,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const url = new URL(challenge.realm)
  if (challenge.service) url.searchParams.set('service', challenge.service)
  if (challenge.scope) url.searchParams.set('scope', challenge.scope)
  // GHCR accepts a personal/installation token as basic creds to mint a scoped
  // bearer; anonymous works for public repos.
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const resp = await fetchImpl(url.toString(), { headers })
  if (!resp.ok) return token
  const body = (await resp.json()) as { token?: string; access_token?: string }
  return body.token ?? body.access_token ?? token
}

export interface FetchOciInventoryOptions {
  ref: string
  /** Bearer token for private registries; anonymous if omitted. */
  token?: string
  fetchImpl?: typeof fetch
}

/**
 * Prod source: fetch the artifact's config blob (zero model bytes) and validate
 * it as the inventory. Fails loud — the gateway must not fall back to a stale
 * suite (Decision 3).
 */
export async function fetchModelInventoryFromOci(
  options: FetchOciInventoryOptions,
): Promise<ModelInventory> {
  const fetchImpl = options.fetchImpl ?? fetch
  const { host, repo, reference } = parseOciRef(options.ref)
  const base = `https://${host}/v2/${repo}`

  const authedFetch = async (
    url: string,
    accept: string,
  ): Promise<Response> => {
    const headers: Record<string, string> = { Accept: accept }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    let resp = await fetchImpl(url, { headers })
    if (resp.status === 401) {
      const challenge = parseBearerChallenge(
        resp.headers.get('www-authenticate') ?? '',
      )
      if (challenge) {
        const token = await resolveToken(challenge, options.token, fetchImpl)
        if (token) {
          resp = await fetchImpl(url, {
            headers: { Accept: accept, Authorization: `Bearer ${token}` },
          })
        }
      }
    }
    return resp
  }

  const manifestResp = await authedFetch(
    `${base}/manifests/${reference}`,
    MANIFEST_ACCEPT,
  )
  if (!manifestResp.ok) {
    throw new ModelInventoryError(
      `failed to fetch model artifact manifest ${options.ref}: HTTP ${String(manifestResp.status)}`,
    )
  }
  const manifest = (await manifestResp.json()) as {
    config?: { digest?: string }
  }
  const configDigest = manifest.config?.digest
  if (!configDigest) {
    throw new ModelInventoryError(
      `model artifact ${options.ref} has no config descriptor`,
    )
  }

  const blobResp = await authedFetch(
    `${base}/blobs/${configDigest}`,
    MODEL_INVENTORY_MEDIA_TYPE,
  )
  if (!blobResp.ok) {
    throw new ModelInventoryError(
      `failed to fetch model inventory config blob for ${options.ref}: HTTP ${String(blobResp.status)}`,
    )
  }
  return parseModelInventory(await blobResp.json())
}
