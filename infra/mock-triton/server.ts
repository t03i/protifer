import { startMockTritonServer } from '@protifer/triton-client'

const PORT = Number(process.env['PORT'] ?? '8001')
const HTTP_PORT = Number(process.env['HTTP_PORT'] ?? '8002')

const server = await startMockTritonServer(PORT)
console.log(`Mock Triton gRPC listening on port ${server.port}`)

const httpServer = Bun.serve({
  port: HTTP_PORT,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('Not Found', { status: 404 })
  },
})
console.log(`Mock Triton HTTP health on port ${httpServer.port}`)
