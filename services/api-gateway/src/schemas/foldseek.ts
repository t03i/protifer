import { z } from '@hono/zod-openapi'

// SSRF protection: only allow HTTPS URLs from known structure file domains
const ALLOWED_HOSTS = [
  'alphafold.ebi.ac.uk',
  'files.rcsb.org',
  'www.ebi.ac.uk',
  'ftp.ebi.ac.uk',
  'models.rcsb.org',
  'swissmodel.expasy.org',
]

// Single source of truth for the SSRF allowlist — also used by the route to
// re-validate each redirect hop (the schema only sees the initial URL).
export function isAllowedStructureUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      ALLOWED_HOSTS.some(
        (h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h),
      )
    )
  } catch {
    return false
  }
}

export const FoldseekRequestSchema = z
  .object({
    model_url: z
      .url()
      .refine(isAllowedStructureUrl, {
        message: 'model_url must be HTTPS from a known structure database',
      })
      .openapi({
        example: 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif',
      }),
    databases: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9_-]+$/i, 'invalid database name'),
      )
      .min(1)
      .max(8)
      .default(['pdb100', 'afdb50', 'afdb-swissprot'])
      .openapi({ example: ['pdb100', 'afdb50', 'afdb-swissprot'] }),
  })
  .openapi('FoldseekRequest')

export const FoldseekResponseSchema = z
  .object({
    ticketId: z.string().openapi({ example: 'abc123xyz' }),
  })
  .openapi('FoldseekResponse')

export const FoldseekErrorSchema = z
  .object({
    error: z.string().openapi({ example: 'Failed to download structure file' }),
    code: z.string().optional().openapi({ example: 'PROXY_ERROR' }),
  })
  .openapi('FoldseekError')
