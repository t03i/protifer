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

type Step = 'ok' | { code: number; details: string }

/** Start a gRPC server that walks `plan` per modelInfer call (last step repeats). */
async function startFlakyTritonServer(plan: Step[]): Promise<{
  stop(): void
  port: number
  calls(): number
}> {
  const proto = getPackageDef()
  const server = new grpc.Server()
  let calls = 0

  server.addService(proto.inference.GRPCInferenceService.service, {
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
      const step = plan[Math.min(calls, plan.length - 1)] ?? 'ok'
      calls++
      if (step === 'ok') {
        cb(null, { model_name: 'test', outputs: [], raw_output_contents: [] })
      } else {
        cb(
          { code: step.code, details: step.details } as grpc.ServiceError,
          null,
        )
      }
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
          calls: () => calls,
        })
      },
    )
  })
}

const FAST_RETRY = { maxAttempts: 3, baseBackoffMs: 1 }

describe('modelInfer transient-transport retry', () => {
  const cleanups: Array<() => void> = []

  afterAll(() => {
    for (const fn of cleanups) fn()
  })

  async function makeClient(plan: Step[]) {
    const srv = await startFlakyTritonServer(plan)
    const client = createTritonClient(`localhost:${srv.port.toString()}`)
    cleanups.push(() => {
      srv.stop()
      client.close()
    })
    return { srv, client }
  }

  const REQ = { model_name: 'test', inputs: [], outputs: [] }

  it('retries on UNAVAILABLE and succeeds after a transient drop', async () => {
    const { srv, client } = await makeClient([
      { code: grpc.status.UNAVAILABLE, details: 'Connection dropped' },
      { code: grpc.status.UNAVAILABLE, details: 'Connection dropped' },
      'ok',
    ])
    const resp = await client.modelInfer(REQ, { retry: FAST_RETRY })
    expect(resp.model_name).toBe('test')
    expect(srv.calls()).toBe(3)
  }, 10_000)

  it('retries on transport-class INTERNAL (bandwidth exhausted)', async () => {
    const { srv, client } = await makeClient([
      {
        code: grpc.status.INTERNAL,
        details: 'Bandwidth exhausted or memory limit exceeded',
      },
      'ok',
    ])
    const resp = await client.modelInfer(REQ, { retry: FAST_RETRY })
    expect(resp.model_name).toBe('test')
    expect(srv.calls()).toBe(2)
  }, 10_000)

  it('does not retry a genuine server INTERNAL', async () => {
    const { srv, client } = await makeClient([
      {
        code: grpc.status.INTERNAL,
        details: 'internal model assertion failed',
      },
      'ok',
    ])
    await expect(
      client.modelInfer(REQ, { retry: FAST_RETRY }),
    ).rejects.toMatchObject({ code: grpc.status.INTERNAL })
    expect(srv.calls()).toBe(1)
  }, 10_000)

  it('does not retry INVALID_ARGUMENT', async () => {
    const { srv, client } = await makeClient([
      { code: grpc.status.INVALID_ARGUMENT, details: 'bad shape' },
      'ok',
    ])
    await expect(
      client.modelInfer(REQ, { retry: FAST_RETRY }),
    ).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT })
    expect(srv.calls()).toBe(1)
  }, 10_000)

  it('does not retry NOT_FOUND', async () => {
    const { srv, client } = await makeClient([
      { code: grpc.status.NOT_FOUND, details: 'no model' },
      'ok',
    ])
    await expect(
      client.modelInfer(REQ, { retry: FAST_RETRY }),
    ).rejects.toMatchObject({ code: grpc.status.NOT_FOUND })
    expect(srv.calls()).toBe(1)
  }, 10_000)

  it('does not retry DEADLINE_EXCEEDED (maps to TritonTimeoutError)', async () => {
    const { srv, client } = await makeClient([
      { code: grpc.status.DEADLINE_EXCEEDED, details: 'too slow' },
      'ok',
    ])
    await expect(client.modelInfer(REQ, { retry: FAST_RETRY })).rejects.toThrow(
      TritonTimeoutError,
    )
    expect(srv.calls()).toBe(1)
  }, 10_000)

  it('surfaces the classified error once retries are exhausted', async () => {
    const { srv, client } = await makeClient([
      { code: grpc.status.UNAVAILABLE, details: 'Connection dropped' },
    ])
    await expect(
      client.modelInfer(REQ, { retry: { maxAttempts: 2, baseBackoffMs: 1 } }),
    ).rejects.toMatchObject({ code: grpc.status.UNAVAILABLE })
    expect(srv.calls()).toBe(2)
  }, 10_000)
})
