import path from 'path'
import { fileURLToPath } from 'url'

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTO_PATH = path.join(__dirname, '../proto/grpc_service.proto')

/**
 * gRPC receive/send cap for Triton inference. Default gRPC limit is 4 MB,
 * which rejects ~1k+ residue embedding responses (#67). 64 MB covers
 * sequences up to ~16k residues at 1024-dim FP32 — raise explicitly if a
 * future model exceeds that.
 */
export const TRITON_MAX_MESSAGE_BYTES = 64 * 1024 * 1024

export const DEFAULT_DEADLINE_MS = 60_000

// Readiness probes must NOT inherit the 60s infer deadline: a Triton that is up
// at TCP but never replies (GPU-driver hang, rolling restart) would otherwise
// hang serverReady/modelReady indefinitely and block the worker boot gate. A
// short deadline resolves the probe to `false` (not ready) so the boot loop
// retries with backoff instead of wedging.
export const READINESS_DEADLINE_MS = 5_000

export const DEFAULT_RETRY_MAX_ATTEMPTS = 3
export const DEFAULT_RETRY_BASE_BACKOFF_MS = 100

const TRANSIENT_INTERNAL_RE =
  /bandwidth exhausted|memory limit exceeded|failed parsing|connection|rst_stream|stream reset/i

function isTransientTransportError(err: unknown): boolean {
  if (err instanceof TritonTimeoutError) return false
  if (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'number'
  ) {
    const code = (err as { code: number }).code
    if (code === (grpc.status.UNAVAILABLE as number)) return true
    if (code === (grpc.status.INTERNAL as number)) {
      const detail = (
        (err as { details?: string }).details ??
        (err as { message?: string }).message ??
        ''
      ).toLowerCase()
      return TRANSIENT_INTERNAL_RE.test(detail)
    }
  }
  return false
}

function retryBackoffMs(baseBackoffMs: number, attempt: number): number {
  const exp = baseBackoffMs * 2 ** (attempt - 1)
  return Math.round(exp / 2 + Math.random() * (exp / 2))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Thrown when a gRPC call to Triton exceeds the configured deadline.
 * Maps to gRPC status code 4 (DEADLINE_EXCEEDED).
 */
export class TritonTimeoutError extends Error {
  constructor(
    message: string,
    public readonly deadlineMs: number,
  ) {
    super(message)
    this.name = 'TritonTimeoutError'
  }
}

export interface TensorInput {
  name: string
  datatype: 'FP32' | 'BYTES' | 'INT64' | 'INT32'
  shape: number[]
  contents?: {
    fp32_contents?: number[]
    bytes_contents?: Buffer[]
    int64_contents?: string[]
  }
}

export interface InferRequest {
  model_name: string
  model_version?: string
  inputs: TensorInput[]
  outputs: Array<{ name: string }>
  raw_input_contents?: Buffer[]
}

export interface TensorOutput {
  name: string
  datatype: string
  shape: number[]
  contents: {
    fp32_contents: number[]
    bytes_contents: Buffer[]
    int64_contents: string[]
  }
}

export interface InferResponse {
  model_name: string
  outputs: TensorOutput[]
  raw_output_contents: Buffer[]
}

export interface ModelInferRetryOptions {
  /** Total attempts including the first. Values ≤1 disable retry. */
  maxAttempts: number
  baseBackoffMs: number
}

export interface ModelInferOptions {
  /** Milliseconds before the gRPC call is cancelled. Defaults to DEFAULT_DEADLINE_MS (60 000). */
  deadlineMs?: number
  /** Bounded jittered retry on transient transport errors. Defaults to the DEFAULT_RETRY_* constants. */
  retry?: ModelInferRetryOptions
}

export interface TritonClient {
  modelInfer(
    request: InferRequest,
    options?: ModelInferOptions,
  ): Promise<InferResponse>
  serverReady(): Promise<boolean>
  modelReady(name: string, version?: string): Promise<boolean>
  close(): void
}

let _packageDef: protoLoader.PackageDefinition | null = null
function getPackageDef(): protoLoader.PackageDefinition {
  if (!_packageDef) {
    _packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    })
  }
  return _packageDef
}

export function createTritonClient(url: string): TritonClient {
  const proto = grpc.loadPackageDefinition(getPackageDef()) as unknown as {
    inference: {
      GRPCInferenceService: new (
        url: string,
        credentials: grpc.ChannelCredentials,
        options?: Record<string, number>,
      ) => grpc.Client & {
        modelInfer: (
          req: InferRequest,
          callOptions: grpc.CallOptions,
          cb: (err: grpc.ServiceError | null, res: InferResponse) => void,
        ) => void
        serverReady: (
          req: Record<string, never>,
          callOptions: grpc.CallOptions,
          cb: (err: grpc.ServiceError | null, res: { ready: boolean }) => void,
        ) => void
        modelReady: (
          req: { name: string; version: string },
          callOptions: grpc.CallOptions,
          cb: (err: grpc.ServiceError | null, res: { ready: boolean }) => void,
        ) => void
      }
    }
  }
  const stub = new proto.inference.GRPCInferenceService(
    url,
    grpc.credentials.createInsecure(),
    {
      'grpc.enable_retries': 0,
      'grpc.max_receive_message_length': TRITON_MAX_MESSAGE_BYTES,
      'grpc.max_send_message_length': TRITON_MAX_MESSAGE_BYTES,
      // Keepalive pings only while calls are in flight (permit_without_calls: 0)
      // so a half-open connection is detected mid-burst without tripping Triton's
      // server-side min-ping-interval enforcement (ENHANCE_YOUR_CALM).
      'grpc.keepalive_time_ms': 30_000,
      'grpc.keepalive_timeout_ms': 10_000,
      'grpc.keepalive_permit_without_calls': 0,
    },
  )

  function callOnce(
    request: InferRequest,
    deadlineMs: number,
  ): Promise<InferResponse> {
    return new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + deadlineMs)
      stub.modelInfer(
        request,
        { deadline },
        (err: grpc.ServiceError | null, response: InferResponse) => {
          if (err) {
            if (err.code === grpc.status.DEADLINE_EXCEEDED) {
              reject(
                new TritonTimeoutError(
                  `Triton modelInfer timed out after ${deadlineMs.toString()} ms`,
                  deadlineMs,
                ),
              )
            } else {
              reject(err)
            }
          } else {
            resolve(response)
          }
        },
      )
    })
  }

  return {
    async modelInfer(
      request: InferRequest,
      { deadlineMs = DEFAULT_DEADLINE_MS, retry }: ModelInferOptions = {},
    ): Promise<InferResponse> {
      const maxAttempts = retry?.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS
      const baseBackoffMs =
        retry?.baseBackoffMs ?? DEFAULT_RETRY_BASE_BACKOFF_MS
      let attempt = 0
      for (;;) {
        attempt++
        try {
          return await callOnce(request, deadlineMs)
        } catch (err) {
          if (attempt >= maxAttempts || !isTransientTransportError(err))
            throw err
          await sleep(retryBackoffMs(baseBackoffMs, attempt))
        }
      }
    },

    serverReady(): Promise<boolean> {
      return new Promise((resolve) => {
        stub.serverReady(
          {},
          { deadline: new Date(Date.now() + READINESS_DEADLINE_MS) },
          (err: grpc.ServiceError | null, response: { ready: boolean }) => {
            resolve(!err && response.ready)
          },
        )
      })
    },

    modelReady(name: string, version: string = ''): Promise<boolean> {
      return new Promise((resolve) => {
        stub.modelReady(
          { name, version },
          { deadline: new Date(Date.now() + READINESS_DEADLINE_MS) },
          (err: grpc.ServiceError | null, response: { ready: boolean }) => {
            resolve(!err && response.ready)
          },
        )
      })
    },

    close() {
      grpc.closeClient(stub)
    },
  }
}
