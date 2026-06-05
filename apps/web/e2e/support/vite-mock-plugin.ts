import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Plugin } from 'vite'

export function e2eMockPlugin(): Plugin {
  return {
    name: 'e2e-mock',
    configureServer(server) {
      // jobId -> call count, drives the sequential polling simulation
      const pollCounters = new Map<string, number>()

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        const sessionMode = req.headers['x-e2e-auth']

        if (url.startsWith('/api/auth/get-session')) {
          const fixture =
            sessionMode === 'authenticated'
              ? 'session-authenticated.json'
              : 'session-unauthenticated.json'
          const data = readFileSync(
            join(import.meta.dirname, '../fixtures', fixture),
            'utf-8',
          )
          res.setHeader('Content-Type', 'application/json')
          res.end(data)
          return
        }

        if (url === '/v1/predictions' && req.method === 'POST') {
          const data = readFileSync(
            join(import.meta.dirname, '../fixtures/submit-response.json'),
            'utf-8',
          )
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(data)
          return
        }

        // Poll route serves queued -> processing -> complete in sequence
        const pollMatch = url.match(/^\/v1\/predictions\/([^/?]+)$/)
        if (pollMatch && req.method === 'GET') {
          const jobId = pollMatch[1]!
          const count = (pollCounters.get(jobId) ?? 0) + 1
          pollCounters.set(jobId, count)
          let fixture: string
          if (count === 1) fixture = 'poll-queued.json'
          else if (count === 2) fixture = 'poll-processing.json'
          else fixture = 'poll-complete-p04637.json'
          const data = readFileSync(
            join(import.meta.dirname, '../fixtures', fixture),
            'utf-8',
          )
          res.setHeader('Content-Type', 'application/json')
          res.end(data)
          return
        }

        // Fallback reset for poll counter state
        if (url === '/e2e/reset-counters' && req.method === 'GET') {
          pollCounters.clear()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
          return
        }

        next()
      })
    },
  }
}
