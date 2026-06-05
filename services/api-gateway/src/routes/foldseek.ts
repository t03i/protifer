import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { defaultPinoOptions } from '@protifer/shared'
import pino from 'pino'

import {
  FoldseekErrorSchema,
  FoldseekRequestSchema,
  FoldseekResponseSchema,
  isAllowedStructureUrl,
} from '../schemas/foldseek.ts'
import type { Variables } from '../types/hono.ts'

const logger = pino({ name: 'foldseek-proxy', ...defaultPinoOptions() })

const FOLDSEEK_TICKET_URL = 'https://search.foldseek.com/api/ticket'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB limit for structure files
const MAX_REDIRECTS = 3 // bounded redirect-follow with per-hop allowlist re-validation
const DOWNLOAD_TIMEOUT = 30_000 // 30s for downloading structure files
const FOLDSEEK_TIMEOUT = 30_000 // 30s for Foldseek API response

const submitRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Foldseek'],
  summary: 'Submit structural similarity search to Foldseek',
  request: {
    body: {
      content: { 'application/json': { schema: FoldseekRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: FoldseekResponseSchema } },
      description: 'Foldseek ticket created successfully',
    },
    400: {
      content: { 'application/json': { schema: FoldseekErrorSchema } },
      description: 'Invalid request',
    },
    502: {
      content: { 'application/json': { schema: FoldseekErrorSchema } },
      description: 'Foldseek or structure download failed',
    },
  },
})

export function createFoldseekRouter(): OpenAPIHono<{ Variables: Variables }> {
  const router = new OpenAPIHono<{ Variables: Variables }>()

  router.openapi(submitRoute, async (c) => {
    const { model_url, databases } = c.req.valid('json')
    const userId = c.get('auth').sub

    logger.info({ model_url, databases, userId }, 'Foldseek proxy request')

    let fileBytes: ArrayBuffer
    let filename: string
    try {
      // Manual redirect handling: fetch follows 3xx by default and the schema
      // only validated the initial host, so an allowlisted host could 302 us to
      // an internal address (SSRF). Follow a bounded number of hops, re-checking
      // each Location against the same allowlist.
      let currentUrl = model_url
      let fileRes: Response
      for (let hop = 0; ; hop++) {
        fileRes = await fetch(currentUrl, {
          redirect: 'manual',
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT),
        })
        if (fileRes.status < 300 || fileRes.status >= 400) break

        const location = fileRes.headers.get('location')
        const next = location ? new URL(location, currentUrl).toString() : null
        if (!next || hop >= MAX_REDIRECTS || !isAllowedStructureUrl(next)) {
          logger.warn(
            { model_url, next, status: fileRes.status, hop },
            'Structure file redirect rejected',
          )
          return c.json({ error: 'Failed to download structure file' }, 502)
        }
        currentUrl = next
      }

      if (!fileRes.ok || !fileRes.body) {
        logger.warn(
          { model_url, status: fileRes.status },
          'Structure file download failed',
        )
        return c.json(
          { error: `Failed to download structure file: ${fileRes.statusText}` },
          502,
        )
      }

      // Fast path: reject oversize before streaming when the server declares it.
      const contentLength = fileRes.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
        return c.json({ error: 'Structure file too large (>10MB)' }, 400)
      }

      // Stream with a hard byte cap so a server that omits content-length and
      // streams >10MB is rejected before the whole body is buffered.
      const reader =
        fileRes.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
      const chunks: Uint8Array[] = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_FILE_SIZE) {
          await reader.cancel()
          return c.json({ error: 'Structure file too large (>10MB)' }, 400)
        }
        chunks.push(value)
      }
      const buf = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        buf.set(chunk, offset)
        offset += chunk.byteLength
      }
      fileBytes = buf.buffer

      filename =
        new URL(currentUrl).pathname.split('/').pop() ?? 'structure.cif'
    } catch (err) {
      logger.error({ err, model_url }, 'Structure file download error')
      return c.json({ error: 'Failed to download structure file' }, 502)
    }

    try {
      const form = new FormData()
      form.append('q', new Blob([fileBytes]), filename)
      for (const db of databases) {
        form.append('database[]', db)
      }
      form.append('mode', '3diaa')

      const ticketRes = await fetch(FOLDSEEK_TICKET_URL, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(FOLDSEEK_TIMEOUT),
      })

      if (!ticketRes.ok) {
        const errBody = await ticketRes.text().catch(() => ticketRes.statusText)
        logger.warn(
          { status: ticketRes.status, body: errBody },
          'Foldseek API error',
        )
        return c.json(
          { error: `Foldseek API error: ${ticketRes.statusText}` },
          502,
        )
      }

      const ticketData = (await ticketRes.json()) as { id: string }
      const ticketId = ticketData.id

      logger.info({ ticketId, sub: userId }, 'Foldseek ticket created')
      return c.json({ ticketId }, 200)
    } catch (err) {
      logger.error({ err }, 'Foldseek ticket submission error')
      return c.json({ error: 'Foldseek service unavailable' }, 502)
    }
  })

  return router
}
