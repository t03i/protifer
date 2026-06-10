import path from 'path'
import { fileURLToPath } from 'url'

import * as protoLoader from '@grpc/proto-loader'
import { describe, it, expect } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTO_PATH = path.join(__dirname, '../proto/grpc_service.proto')

/**
 * Field numbers are the wire contract with Triton's GRPCInferenceService — they
 * MUST match KServe v2 (triton-inference-server/common grpc_service.proto). A
 * mismatch is silent: the mock server shares this proto so JS↔JS round-trips
 * stay self-consistent, but a real Triton parses our `inputs` bytes into a
 * different field and reports "expected 1 inputs but got 0 inputs".
 */
const CANONICAL_FIELD_NUMBERS: Record<string, Record<string, number>> = {
  'inference.ModelInferRequest': {
    model_name: 1,
    model_version: 2,
    id: 3,
    inputs: 5,
    outputs: 6,
    raw_input_contents: 7,
  },
  'inference.InferInputTensor': {
    name: 1,
    datatype: 2,
    shape: 3,
    contents: 5,
  },
  'inference.ModelInferResponse': {
    model_name: 1,
    model_version: 2,
    id: 3,
    outputs: 5,
    raw_output_contents: 6,
  },
  'inference.InferOutputTensor': {
    name: 1,
    datatype: 2,
    shape: 3,
    contents: 5,
  },
  'inference.InferTensorContents': {
    bytes_contents: 8,
  },
}

function fieldNumbers(
  pkg: protoLoader.PackageDefinition,
  message: string,
): Record<string, number> {
  const def = pkg[message] as {
    type?: { field?: { name: string; number: number }[] }
  }
  const fields = def.type?.field ?? []
  return Object.fromEntries(fields.map((f) => [f.name, f.number]))
}

describe('grpc_service.proto wire contract', () => {
  const pkg = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  for (const [message, expected] of Object.entries(CANONICAL_FIELD_NUMBERS)) {
    it(`${message} field numbers match KServe v2`, () => {
      const actual = fieldNumbers(pkg, message)
      for (const [field, number] of Object.entries(expected)) {
        expect(actual[field], `${message}.${field}`).toBe(number)
      }
    })
  }
})
