import path from 'path'
import { fileURLToPath } from 'url'

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTO_PATH = path.join(__dirname, '../proto/grpc_service.proto')

export interface InferenceProto {
  inference: { GRPCInferenceService: { service: grpc.ServiceDefinition } }
}

let cached: InferenceProto | undefined

/**
 * Loads and memoizes the Triton gRPC `GRPCInferenceService` package definition.
 * Shared by the mock server and the client timeout test.
 */
export function getPackageDef(): InferenceProto {
  if (!cached) {
    const packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    })
    cached = grpc.loadPackageDefinition(packageDef) as unknown as InferenceProto
  }
  return cached
}
