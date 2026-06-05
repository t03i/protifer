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

export interface ModelInferOptions {
  /** Milliseconds before the gRPC call is cancelled. Defaults to DEFAULT_DEADLINE_MS (60 000). */
  deadlineMs?: number
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
          cb: (err: grpc.ServiceError | null, res: { ready: boolean }) => void,
        ) => void
        modelReady: (
          req: { name: string; version: string },
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
    },
  )

  return {
    modelInfer(
      request: InferRequest,
      { deadlineMs = DEFAULT_DEADLINE_MS }: ModelInferOptions = {},
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
    },

    serverReady(): Promise<boolean> {
      return new Promise((resolve) => {
        stub.serverReady(
          {},
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
