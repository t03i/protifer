import * as grpc from '@grpc/grpc-js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  createTritonClient,
  DEFAULT_DEADLINE_MS,
  TritonTimeoutError,
} from './client.ts'
import { getPackageDef } from './proto-loader.ts'

/** Start a minimal gRPC server whose modelInfer handler delays before replying. */
async function startSlowTritonServer(delayMs: number): Promise<{
  stop(): void
  port: number
}> {
  const proto = getPackageDef()
  const server = new grpc.Server()

  server.addService(proto.inference.GRPCInferenceService.service, {
    serverLive: (
      _: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<object>,
    ) => {
      cb(null, { live: true })
    },

    serverReady: (
      _: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<object>,
    ) => {
      cb(null, { ready: true })
    },

    modelReady: (
      _: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<object>,
    ) => {
      cb(null, { ready: true })
    },

    modelInfer: (
      _: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<object>,
    ) => {
      setTimeout(() => {
        cb(null, {
          model_name: 'test',
          outputs: [],
          raw_output_contents: [],
        })
      }, delayMs)
    },
  })

  return new Promise((resolve, reject) => {
    server.bindAsync(
      '0.0.0.0:0',
      grpc.ServerCredentials.createInsecure(),
      (err: Error | null, boundPort: number) => {
        if (err) {
          reject(err)
          return
        }
        resolve({
          stop: () => {
            server.forceShutdown()
          },
          port: boundPort,
        })
      },
    )
  })
}

describe('createTritonClient', () => {
  it('returns an object with modelInfer and close methods', () => {
    const client = createTritonClient('localhost:8001')
    expect(typeof client.modelInfer).toBe('function')
    expect(typeof client.close).toBe('function')
    client.close()
  })

  it('returns an object with a modelReady method', () => {
    const client = createTritonClient('localhost:8001')
    expect(typeof client.modelReady).toBe('function')
    client.close()
  })

  it('modelReady satisfies the TritonClient type signature', () => {
    const client = createTritonClient('localhost:8001')
    // Compile-time assertion that the method signature matches.
    const _: (name: string, version?: string) => Promise<boolean> =
      client.modelReady.bind(client)
    expect(typeof _).toBe('function')
    client.close()
  })
})

describe('DEFAULT_DEADLINE_MS', () => {
  it('equals 60 000 ms', () => {
    expect(DEFAULT_DEADLINE_MS).toBe(60_000)
  })
})

describe('TritonTimeoutError', () => {
  it('has name TritonTimeoutError and exposes deadlineMs', () => {
    const err = new TritonTimeoutError('timed out', 1234)
    expect(err.name).toBe('TritonTimeoutError')
    expect(err.message).toBe('timed out')
    expect(err.deadlineMs).toBe(1234)
    expect(err instanceof Error).toBe(true)
    expect(err instanceof TritonTimeoutError).toBe(true)
  })
})

describe('modelInfer deadline enforcement', () => {
  // Server replies after 500 ms; we test with a very short deadline.
  const SERVER_REPLY_DELAY = 500
  let slowServer: { stop(): void; port: number }
  let client: ReturnType<typeof createTritonClient>

  beforeAll(async () => {
    slowServer = await startSlowTritonServer(SERVER_REPLY_DELAY)
    client = createTritonClient(`localhost:${slowServer.port.toString()}`)
  }, 10_000)

  afterAll(() => {
    slowServer.stop()
    client.close()
  })

  it('rejects with TritonTimeoutError when deadline is shorter than server reply time', async () => {
    const shortDeadline = 100 // ms — well below the 500 ms server delay

    await expect(
      client.modelInfer(
        { model_name: 'test', inputs: [], outputs: [] },
        { deadlineMs: shortDeadline },
      ),
    ).rejects.toThrow(TritonTimeoutError)
  }, 10_000)

  it('TritonTimeoutError carries the configured deadlineMs', async () => {
    const shortDeadline = 100

    let caught: unknown
    try {
      await client.modelInfer(
        { model_name: 'test', inputs: [], outputs: [] },
        { deadlineMs: shortDeadline },
      )
    } catch (err) {
      caught = err
    }

    expect(caught instanceof TritonTimeoutError).toBe(true)
    expect((caught as TritonTimeoutError).deadlineMs).toBe(shortDeadline)
  }, 10_000)

  it('applies DEFAULT_DEADLINE_MS when no options are passed (compile-time assertion)', () => {
    // Can't wait 60 s; just verify the call compiles without a second arg and
    // doesn't throw synchronously. The default value itself is covered above.
    const callPromise = client.modelInfer({
      model_name: 'test',
      inputs: [],
      outputs: [],
    })
    expect(callPromise).toBeInstanceOf(Promise)
    callPromise.catch(() => undefined)
  })

  it('succeeds when deadline is longer than server reply time', async () => {
    // 1 500 ms deadline >> 500 ms server delay
    const response = await client.modelInfer(
      { model_name: 'test', inputs: [], outputs: [] },
      { deadlineMs: 1_500 },
    )
    expect(response).toBeDefined()
    expect(response.model_name).toBe('test')
  }, 10_000)
})
